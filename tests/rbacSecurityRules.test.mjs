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

    // 4. Default signed-in staff
    return 'staff';
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

  // Staff member gets staff:
  assert.equal(resolveUserRole('sarah@moshiurban.com', db), 'staff');
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
      case 'undo_change_log':
        return ['admin', 'manager'].includes(role);

      case 'delete_booking':
      case 'manage_user_roles':
      case 'clear_database':
      case 'system_settings':
        return role === 'admin';

      default:
        return false;
    }
  };

  // Staff (View-only for front desk)
  assert.equal(canPerformAction('staff', 'view_availability'), true);
  assert.equal(canPerformAction('staff', 'view_overview'), true);
  assert.equal(canPerformAction('staff', 'create_booking'), false);
  assert.equal(canPerformAction('staff', 'delete_booking'), false);
  assert.equal(canPerformAction('staff', 'manage_user_roles'), false);

  // Property Manager
  assert.equal(canPerformAction('manager', 'view_availability'), true);
  assert.equal(canPerformAction('manager', 'create_booking'), true);
  assert.equal(canPerformAction('manager', 'check_in_guest'), true);
  assert.equal(canPerformAction('manager', 'collect_payment'), true);
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
});
