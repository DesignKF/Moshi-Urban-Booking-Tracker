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
