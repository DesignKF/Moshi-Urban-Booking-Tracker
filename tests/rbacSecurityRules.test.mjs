import test from 'node:test';
import assert from 'node:assert/strict';

test('RBAC Security: User role assignment and permission verification', () => {
  const SYSTEM_ADMINS = ['designkilifair@gmail.com', 'wolfgodie@gmail.com', 'gdnjau@gmail.com'];
  const SYSTEM_MANAGERS = ['moshiurbanproperty@gmail.com'];

  const resolveUserRole = (email, userRolesDatabase) => {
    if (!email) return 'viewer';
    const norm = email.toLowerCase().trim();

    // 1. Authoritative record in user_roles
    const dbRecord = userRolesDatabase.find(r => r.email.toLowerCase() === norm);
    if (dbRecord) {
      if (dbRecord.status === 'suspended') return 'suspended';
      return dbRecord.role;
    }

    // 2. Built-in system administrator emails
    if (SYSTEM_ADMINS.includes(norm)) return 'admin';

    // 3. Built-in property manager email
    if (SYSTEM_MANAGERS.includes(norm)) return 'manager';

    // 4. Default for unapproved accounts
    return 'viewer';
  };

  const db = [
    { email: 'sarah@moshiurban.com', role: 'staff', status: 'active' },
    { email: 'badactor@example.com', role: 'manager', status: 'suspended' },
    { email: 'newmanager@moshiurban.com', role: 'manager', status: 'active' }
  ];

  // Lead admin gets admin:
  assert.equal(resolveUserRole('designkilifair@gmail.com', db), 'admin');

  // Co-admins get admin:
  assert.equal(resolveUserRole('wolfgodie@gmail.com', db), 'admin');
  assert.equal(resolveUserRole('gdnjau@gmail.com', db), 'admin');

  // Suspended user gets suspended status (blocking all write access):
  assert.equal(resolveUserRole('badactor@example.com', db), 'suspended');

  // Approved manager gets manager:
  assert.equal(resolveUserRole('newmanager@moshiurban.com', db), 'manager');

  // Approved staff member gets staff:
  assert.equal(resolveUserRole('sarah@moshiurban.com', db), 'staff');

  // Unapproved personal Google account gets viewer (access blocked):
  assert.equal(resolveUserRole('random.visitor@gmail.com', db), 'viewer');
});

test('RBAC Security: Privilege escalation prevention (users cannot elevate themselves to admin)', () => {
  const validateUserProfileUpdate = (currentUserEmail, incomingData, currentRole) => {
    // If incoming payload tries to set role to admin or manager:
    if (incomingData.role && incomingData.role !== 'staff') {
      if (currentRole !== 'admin') {
        throw new Error('PERMISSION_DENIED: Non-admin users cannot elevate role');
      }
    }
    return true;
  };

  // Staff user trying to send role: admin
  assert.throws(
    () => validateUserProfileUpdate('sarah@moshiurban.com', { role: 'admin' }, 'staff'),
    /PERMISSION_DENIED/
  );

  // Admin updating their profile is allowed
  assert.equal(
    validateUserProfileUpdate('designkilifair@gmail.com', { role: 'admin' }, 'admin'),
    true
  );
});

test('RBAC Security: Operation authorization matrix', () => {
  const canPerformAction = (role, action) => {
    if (role === 'suspended' || role === 'viewer') return false;

    switch (action) {
      case 'view_availability':
      case 'view_overview':
        return ['admin', 'manager', 'staff'].includes(role);

      case 'create_booking':
      case 'edit_booking':
      case 'check_in_guest':
      case 'check_out_guest':
      case 'collect_payment':
        return ['admin', 'manager', 'staff'].includes(role);

      case 'undo_change_log':
        return ['admin', 'manager'].includes(role);

      case 'delete_booking':
      case 'delete_guest':
      case 'delete_payment':
      case 'manage_user_roles':
      case 'clear_database':
      case 'system_settings':
        return role === 'admin';

      default:
        return false;
    }
  };

  // Staff (Operational front desk)
  assert.equal(canPerformAction('staff', 'view_availability'), true);
  assert.equal(canPerformAction('staff', 'view_overview'), true);
  assert.equal(canPerformAction('staff', 'create_booking'), true);
  assert.equal(canPerformAction('staff', 'check_in_guest'), true);
  assert.equal(canPerformAction('staff', 'collect_payment'), true);
  assert.equal(canPerformAction('staff', 'delete_booking'), false);
  assert.equal(canPerformAction('staff', 'manage_user_roles'), false);

  // Property Manager
  assert.equal(canPerformAction('manager', 'view_availability'), true);
  assert.equal(canPerformAction('manager', 'create_booking'), true);
  assert.equal(canPerformAction('manager', 'check_in_guest'), true);
  assert.equal(canPerformAction('manager', 'collect_payment'), true);
  assert.equal(canPerformAction('manager', 'undo_change_log'), true);
  assert.equal(canPerformAction('manager', 'delete_booking'), false);
  assert.equal(canPerformAction('manager', 'manage_user_roles'), false); // Only admin

  // Administrator
  assert.equal(canPerformAction('admin', 'view_availability'), true);
  assert.equal(canPerformAction('admin', 'create_booking'), true);
  assert.equal(canPerformAction('admin', 'delete_booking'), true);
  assert.equal(canPerformAction('admin', 'manage_user_roles'), true);
  assert.equal(canPerformAction('admin', 'clear_database'), true);

  // Suspended user
  assert.equal(canPerformAction('suspended', 'view_availability'), false);
  assert.equal(canPerformAction('suspended', 'create_booking'), false);
  assert.equal(canPerformAction('suspended', 'collect_payment'), false);

  // Viewer / Unapproved account
  assert.equal(canPerformAction('viewer', 'view_availability'), false);
  assert.equal(canPerformAction('viewer', 'create_booking'), false);
});

test('RBAC Security: Schema validation and Dirty Dozen rejection simulation', () => {
  const isValidId = (id) => typeof id === 'string' && id.length > 0 && id.length <= 128 && /^[a-zA-Z0-9_\-]+$/.test(id);

  const isValidReservation = (data) => {
    const required = ['id', 'guestName', 'room', 'bedCode', 'checkIn', 'checkOut', 'status'];
    for (const k of required) {
      if (!(k in data)) return false;
    }
    if (!isValidId(data.id) || data.id.length > 64) return false;
    if (typeof data.guestName !== 'string' || data.guestName.length === 0 || data.guestName.length > 150) return false;
    if (typeof data.room !== 'string' || data.room.length === 0 || data.room.length > 100) return false;
    if (typeof data.bedCode !== 'string' || data.bedCode.length === 0 || data.bedCode.length > 30) return false;
    if (data.checkIn >= data.checkOut) return false;
    if (data.notes && data.notes.length > 1000) return false;
    if (data.currency && !['USD', 'TZS', 'EUR', 'GBP'].includes(data.currency)) return false;
    if (data.totalAmount !== undefined && (typeof data.totalAmount !== 'number' || data.totalAmount < 0)) return false;
    if (data.paidAmount !== undefined && (typeof data.paidAmount !== 'number' || data.paidAmount < 0)) return false;
    return true;
  };

  const isValidPayment = (data) => {
    const required = ['id', 'reservationId', 'amount', 'currency', 'type', 'recordedBy'];
    for (const k of required) {
      if (!(k in data)) return false;
    }
    if (!isValidId(data.id) || !isValidId(data.reservationId)) return false;
    if (typeof data.amount !== 'number' || data.amount <= 0) return false;
    if (!['USD', 'TZS', 'EUR', 'GBP'].includes(data.currency)) return false;
    if (!['deposit', 'balance', 'full', 'refund', 'fee'].includes(data.type)) return false;
    return true;
  };

  // Valid reservation passes
  assert.equal(isValidReservation({
    id: 'MU-101',
    guestName: 'Jane Doe',
    room: 'Njoro (Room 2)',
    bedCode: 'N-B1L',
    checkIn: '2026-11-01',
    checkOut: '2026-11-04',
    status: 'Confirmed',
    currency: 'USD',
    totalAmount: 60,
    paidAmount: 20
  }), true);

  // Dirty Dozen 1: Missing required fields
  assert.equal(isValidReservation({ id: 'MU-102', guestName: 'No Room' }), false);

  // Dirty Dozen 2: Inverted dates (checkIn >= checkOut)
  assert.equal(isValidReservation({
    id: 'MU-103',
    guestName: 'Time Traveler',
    room: 'Njoro',
    bedCode: 'N-B1L',
    checkIn: '2026-11-05',
    checkOut: '2026-11-02',
    status: 'Confirmed'
  }), false);

  // Dirty Dozen 3: Same day checkIn and checkOut
  assert.equal(isValidReservation({
    id: 'MU-104',
    guestName: 'Zero Night',
    room: 'Njoro',
    bedCode: 'N-B1L',
    checkIn: '2026-11-05',
    checkOut: '2026-11-05',
    status: 'Confirmed'
  }), false);

  // Dirty Dozen 4: ID with path traversal
  assert.equal(isValidId('../bad_id'), false);
  assert.equal(isValidId('id with spaces'), false);

  // Dirty Dozen 5: Excessive string (buffer overflow prevention)
  assert.equal(isValidReservation({
    id: 'MU-105',
    guestName: 'A'.repeat(200),
    room: 'Njoro',
    bedCode: 'N-B1L',
    checkIn: '2026-11-01',
    checkOut: '2026-11-02',
    status: 'Confirmed'
  }), false);

  // Dirty Dozen 6: Unsupported currency
  assert.equal(isValidReservation({
    id: 'MU-106',
    guestName: 'Crypto Fan',
    room: 'Njoro',
    bedCode: 'N-B1L',
    checkIn: '2026-11-01',
    checkOut: '2026-11-02',
    status: 'Confirmed',
    currency: 'BITCOIN'
  }), false);

  // Dirty Dozen 7: Negative payment amount
  assert.equal(isValidPayment({
    id: 'PAY-1',
    reservationId: 'MU-101',
    amount: -50,
    currency: 'USD',
    type: 'deposit',
    recordedBy: 'staff@moshiurban.com'
  }), false);

  // Dirty Dozen 8: Zero payment amount
  assert.equal(isValidPayment({
    id: 'PAY-2',
    reservationId: 'MU-101',
    amount: 0,
    currency: 'USD',
    type: 'deposit',
    recordedBy: 'staff@moshiurban.com'
  }), false);
});
