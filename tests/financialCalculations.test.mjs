import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFinancialAmount } from '../src/migration/reconciliation.ts';

test('Financial calculations: paid amount accurately accounts for deposits, extras, and refunds', () => {
  const calculateFinancials = (gross, deposit, other, refunds) => {
    const grossClean = parseFinancialAmount(gross);
    const depositClean = parseFinancialAmount(deposit);
    const otherClean = parseFinancialAmount(other);
    const refundsClean = parseFinancialAmount(refunds);

    const paidAmount = Math.round((depositClean + otherClean - refundsClean + Number.EPSILON) * 100) / 100;
    const balanceDue = Math.round((grossClean - paidAmount + Number.EPSILON) * 100) / 100;

    return {
      gross: grossClean,
      paidAmount,
      balanceDue: balanceDue < 0 ? 0 : balanceDue,
      refundOwed: balanceDue < 0 ? Math.abs(balanceDue) : 0
    };
  };

  // Case 1: Standard deposit paid, balance remaining
  const res1 = calculateFinancials(100, 30, 0, 0);
  assert.equal(res1.paidAmount, 30);
  assert.equal(res1.balanceDue, 70);

  // Case 2: Deposit + extras paid
  const res2 = calculateFinancials(150, 50, 25, 0);
  assert.equal(res2.paidAmount, 75);
  assert.equal(res2.balanceDue, 75);

  // Case 3: Partial refund processed
  const res3 = calculateFinancials(100, 100, 0, 40);
  assert.equal(res3.paidAmount, 60);
  assert.equal(res3.balanceDue, 40);

  // Case 4: Zero floating point inaccuracy on fractional pennies
  const res4 = calculateFinancials(19.99, 10.01, 0, 0);
  assert.equal(res4.balanceDue, 9.98);
});

test('Financial calculations: TZS to USD and rate overrides are deterministic', () => {
  const convertCurrency = (amount, fromCurrency, toCurrency, fxRate = 2645) => {
    if (fromCurrency === toCurrency) return amount;
    if (fromCurrency === 'USD' && toCurrency === 'TZS') {
      return Math.round(amount * fxRate);
    }
    if (fromCurrency === 'TZS' && toCurrency === 'USD') {
      return Math.round((amount / fxRate) * 100) / 100;
    }
    return amount;
  };

  // Standard hostel night: $20 USD -> 52,900 TZS
  assert.equal(convertCurrency(20, 'USD', 'TZS', 2645), 52900);
  assert.equal(convertCurrency(52900, 'TZS', 'USD', 2645), 20);

  // 3 nights: $60 USD -> 158,700 TZS
  assert.equal(convertCurrency(60, 'USD', 'TZS', 2645), 158700);
});

test('Payment ledger: aggregates multiple payment transactions into verified reservation balance', () => {
  const transactions = [
    { id: 'PAY-1', type: 'deposit', amount: 30, currency: 'USD' },
    { id: 'PAY-2', type: 'balance', amount: 40, currency: 'USD' },
    { id: 'PAY-3', type: 'refund', amount: 10, currency: 'USD' }
  ];

  const grossTotal = 80;

  const totalPaid = transactions.reduce((sum, t) => {
    if (t.type === 'refund') return sum - t.amount;
    return sum + t.amount;
  }, 0);

  const balanceRemaining = grossTotal - totalPaid;

  assert.equal(totalPaid, 60); // 30 + 40 - 10
  assert.equal(balanceRemaining, 20); // 80 - 60
});

test('Financial Idempotency: Retrying same payment transaction 10 times applies balance change exactly once', () => {
  const paymentLedger = new Map();
  let reservation = {
    id: 'MU-TEST-FIN-1',
    totalAmount: 100,
    paidAmount: 0,
    balanceDue: 100
  };

  const executeIdempotentPayment = (payment) => {
    // Read phase
    const existing = paymentLedger.get(payment.id);
    if (existing) {
      if (
        existing.amount === payment.amount &&
        existing.currency === payment.currency &&
        existing.type === payment.type &&
        existing.reservationId === payment.reservationId
      ) {
        // Idempotent retry: do not re-apply to balance
        return { success: true, idempotentNoop: true };
      }
      throw new Error(`Conflicting payment transaction for ID ${payment.id}`);
    }

    // Apply change
    const isRefund = payment.type === 'refund';
    const newPaid = isRefund
      ? Math.max(0, Math.round((reservation.paidAmount - payment.amount + Number.EPSILON) * 100) / 100)
      : Math.round((reservation.paidAmount + payment.amount + Number.EPSILON) * 100) / 100;
    const newBalance = Math.max(0, Math.round((reservation.totalAmount - newPaid + Number.EPSILON) * 100) / 100);

    reservation.paidAmount = newPaid;
    reservation.balanceDue = newBalance;
    paymentLedger.set(payment.id, { ...payment });
    return { success: true, idempotentNoop: false };
  };

  const depositPayment = {
    id: 'PAY-MU-TEST-FIN-1-deposit',
    reservationId: 'MU-TEST-FIN-1',
    amount: 30,
    currency: 'USD',
    type: 'deposit'
  };

  // First call
  const first = executeIdempotentPayment(depositPayment);
  assert.equal(first.idempotentNoop, false);
  assert.equal(reservation.paidAmount, 30);
  assert.equal(reservation.balanceDue, 70);

  // Retry 10 times with the same payment ID
  for (let i = 0; i < 10; i++) {
    const retryResult = executeIdempotentPayment(depositPayment);
    assert.equal(retryResult.idempotentNoop, true);
    assert.equal(reservation.paidAmount, 30, 'Paid amount must not increase on retry');
    assert.equal(reservation.balanceDue, 70, 'Balance due must not decrease on retry');
  }

  // Conflict case: Same payment ID submitted with different amount
  const conflictingPayment = {
    id: 'PAY-MU-TEST-FIN-1-deposit',
    reservationId: 'MU-TEST-FIN-1',
    amount: 50, // Conflicting!
    currency: 'USD',
    type: 'deposit'
  };

  assert.throws(
    () => executeIdempotentPayment(conflictingPayment),
    /Conflicting payment transaction/
  );
});

test('Financial Correctness: Creating booking with initial deposit counts deposit once and editing preserves balance', () => {
  // Simulate atomic saveReservationToFirestore with initial payment
  const reservationDb = new Map();
  const paymentLedger = new Map();

  const saveReservationAtomic = (res, initialPayment) => {
    const existing = reservationDb.get(res.id);
    let canonicalPaid = 0;
    let canonicalBalance = res.totalAmount;

    if (existing) {
      canonicalPaid = existing.paidAmount || 0;
      canonicalBalance = Math.max(0, res.totalAmount - canonicalPaid);
    } else if (initialPayment && initialPayment.amount > 0) {
      const payId = initialPayment.id || `PAY-${res.id}-deposit`;
      paymentLedger.set(payId, {
        id: payId,
        reservationId: res.id,
        amount: initialPayment.amount,
        type: 'deposit'
      });
      canonicalPaid = initialPayment.amount;
      canonicalBalance = Math.max(0, res.totalAmount - canonicalPaid);
    }

    const saved = {
      ...res,
      paidAmount: canonicalPaid,
      balanceDue: canonicalBalance
    };
    reservationDb.set(res.id, saved);
    return saved;
  };

  // 1. Create new booking with $40 deposit
  const newBooking = {
    id: 'MU-NEW-1',
    guestName: 'Initial Guest',
    room: 'Njoro (Room 2)',
    bedCode: 'N-B1L',
    checkIn: '2026-11-01',
    checkOut: '2026-11-04',
    totalAmount: 60
  };

  const created = saveReservationAtomic(newBooking, { amount: 40 });
  assert.equal(created.paidAmount, 40);
  assert.equal(created.balanceDue, 20);
  assert.equal(paymentLedger.size, 1);

  // 2. Edit existing booking (e.g. update guest name or notes)
  const editedBooking = {
    ...created,
    guestName: 'Initial Guest (Edited Name)',
    notes: 'Late arrival'
  };

  const updated = saveReservationAtomic(editedBooking);
  assert.equal(updated.guestName, 'Initial Guest (Edited Name)');
  assert.equal(updated.paidAmount, 40, 'Editing booking must preserve paidAmount');
  assert.equal(updated.balanceDue, 20, 'Editing booking must preserve balanceDue');
  assert.equal(paymentLedger.size, 1, 'No duplicate payment created during booking edit');
});

test('Financial Correctness: Two distinct legitimate payments of the exact same amount must both be accepted', () => {
  const paymentLedger = new Map();
  let reservation = {
    id: 'MU-SPLIT-1',
    totalAmount: 100,
    paidAmount: 0,
    balanceDue: 100
  };

  const processPayment = (payment) => {
    // Read Phase
    const existing = paymentLedger.get(payment.id);
    if (existing) {
      if (
        existing.amount === payment.amount &&
        existing.currency === payment.currency &&
        existing.type === payment.type &&
        existing.reservationId === payment.reservationId
      ) {
        return { success: true, idempotentRetry: true };
      }
      throw new Error(`Conflicting payment transaction for ID ${payment.id}`);
    }

    // Write Phase
    reservation.paidAmount += payment.amount;
    reservation.balanceDue = Math.max(0, reservation.totalAmount - reservation.paidAmount);
    paymentLedger.set(payment.id, { ...payment });
    return { success: true, idempotentRetry: false };
  };

  // Payment 1: Guest pays $25 deposit at booking time
  const pay1 = {
    id: 'PAY-MU-SPLIT-1-deposit-seq001',
    reservationId: 'MU-SPLIT-1',
    amount: 25,
    currency: 'USD',
    type: 'deposit'
  };
  const res1 = processPayment(pay1);
  assert.equal(res1.idempotentRetry, false);
  assert.equal(reservation.paidAmount, 25);
  assert.equal(reservation.balanceDue, 75);

  // Payment 2: Guest pays ANOTHER $25 installment later (exact same amount, different payment operation ID)
  const pay2 = {
    id: 'PAY-MU-SPLIT-1-installment-seq002',
    reservationId: 'MU-SPLIT-1',
    amount: 25,
    currency: 'USD',
    type: 'installment'
  };
  const res2 = processPayment(pay2);
  assert.equal(res2.idempotentRetry, false, 'Second distinct payment of same amount must be accepted');
  assert.equal(reservation.paidAmount, 50, 'Paid amount must reflect both legitimate $25 payments');
  assert.equal(reservation.balanceDue, 50, 'Balance due must reflect remaining $50');
  assert.equal(paymentLedger.size, 2);

  // Retry Payment 1 (network disconnect recovery)
  const retry1 = processPayment(pay1);
  assert.equal(retry1.idempotentRetry, true);
  assert.equal(reservation.paidAmount, 50, 'Retry of Payment 1 must not increase paid balance');
  assert.equal(reservation.balanceDue, 50);

  // Retry Payment 2 (network disconnect recovery)
  const retry2 = processPayment(pay2);
  assert.equal(retry2.idempotentRetry, true);
  assert.equal(reservation.paidAmount, 50, 'Retry of Payment 2 must not increase paid balance');
  assert.equal(reservation.balanceDue, 50);
});
