import React, { useState, useEffect, useMemo } from 'react';
import {
  ShieldCheck,
  UserPlus,
  KeyRound,
  Eye,
  Trash2,
  Edit2,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Database,
  Building,
  HelpCircle,
  X
} from 'lucide-react';
import {
  AppUserAccount,
  UserRoleType,
  SYSTEM_ADMIN_EMAILS,
  SYSTEM_PROPERTY_MANAGER_EMAILS,
  fetchUserAccountsFromFirestore,
  saveUserAccountToFirestore,
  deleteUserAccountFromFirestore,
  seedDefaultAccountsToFirestore
} from './firebase';

interface AdminPanelProps {
  currentUserEmail: string | null;
  onToast: (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({ currentUserEmail, onToast }) => {
  const [users, setUsers] = useState<AppUserAccount[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isSeeding, setIsSeeding] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRoleType>('all');

  // Modal states
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [editingUser, setEditingUser] = useState<AppUserAccount | null>(null);
  const [deletingUser, setDeletingUser] = useState<AppUserAccount | null>(null);

  // Form states for Add/Edit
  const [formEmail, setFormEmail] = useState<string>('');
  const [formDisplayName, setFormDisplayName] = useState<string>('');
  const [formRole, setFormRole] = useState<UserRoleType>('staff');
  const [formStatus, setFormStatus] = useState<'active' | 'suspended'>('active');
  const [formError, setFormError] = useState<string>('');

  const loadUsers = async () => {
    setIsLoading(true);
    try {
      const data = await fetchUserAccountsFromFirestore();
      setUsers(data);
    } catch (err: any) {
      console.error('Error fetching users:', err);
      onToast('Could not load user accounts from database.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleOpenAddModal = () => {
    setFormEmail('');
    setFormDisplayName('');
    setFormRole('staff');
    setFormStatus('active');
    setFormError('');
    setIsAddModalOpen(true);
  };

  const handleOpenEditModal = (user: AppUserAccount) => {
    setEditingUser(user);
    setFormEmail(user.email);
    setFormDisplayName(user.displayName || '');
    setFormRole(user.role);
    setFormStatus(user.status || 'active');
    setFormError('');
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const trimmedEmail = formEmail.toLowerCase().trim();
    if (!trimmedEmail) {
      setFormError('Please enter a valid email address.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setFormError('Please enter a valid email address format (e.g. name@domain.com).');
      return;
    }

    setIsSaving(true);
    try {
      const accountToSave: AppUserAccount = {
        email: trimmedEmail,
        displayName: formDisplayName.trim() || trimmedEmail.split('@')[0],
        role: formRole,
        status: formStatus,
        createdAt: editingUser?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        updatedBy: currentUserEmail || 'admin'
      };

      await saveUserAccountToFirestore(accountToSave, currentUserEmail || 'admin');
      
      onToast(
        editingUser
          ? `Updated role for ${trimmedEmail} to ${formRole.toUpperCase()}`
          : `Added new user ${trimmedEmail} as ${formRole.toUpperCase()}`,
        'success'
      );

      setIsAddModalOpen(false);
      setEditingUser(null);
      await loadUsers();
    } catch (err: any) {
      console.error('Error saving user:', err);
      setFormError(err.message || 'Failed to save user account to Firestore.');
      onToast('Failed to save user account. Verify admin permissions.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!deletingUser) return;
    const targetEmail = deletingUser.email.toLowerCase().trim();

    // Protection rule: cannot delete lead admin designkilifair@gmail.com or current user
    if (targetEmail === 'designkilifair@gmail.com') {
      onToast('The primary system administrator account cannot be deleted.', 'warning');
      setDeletingUser(null);
      return;
    }

    if (currentUserEmail && targetEmail === currentUserEmail.toLowerCase().trim()) {
      onToast('You cannot delete your own active administrator account.', 'warning');
      setDeletingUser(null);
      return;
    }

    setIsSaving(true);
    try {
      await deleteUserAccountFromFirestore(targetEmail);
      onToast(`Removed user account for ${targetEmail}.`, 'success');
      setDeletingUser(null);
      await loadUsers();
    } catch (err: any) {
      console.error('Error deleting user:', err);
      onToast('Failed to remove user account from Firestore.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSeedDefaults = async () => {
    if (!currentUserEmail) {
      onToast('Please sign in as an admin to seed default roles.', 'warning');
      return;
    }
    setIsSeeding(true);
    try {
      const count = await seedDefaultAccountsToFirestore(currentUserEmail);
      onToast(`Synced ${count} standard accounts to Firebase Firestore!`, 'success');
      await loadUsers();
    } catch (err: any) {
      console.error('Error seeding defaults:', err);
      onToast('Failed to sync default roles to Firebase.', 'error');
    } finally {
      setIsSeeding(false);
    }
  };

  // Filtered users
  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      const matchesSearch =
        u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (u.displayName && u.displayName.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesRole = roleFilter === 'all' || u.role === roleFilter;
      return matchesSearch && matchesRole;
    });
  }, [users, searchQuery, roleFilter]);

  const adminCount = useMemo(() => users.filter(u => u.role === 'admin').length, [users]);
  const managerCount = useMemo(() => users.filter(u => u.role === 'manager').length, [users]);
  const staffCount = useMemo(() => users.filter(u => u.role === 'staff').length, [users]);

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      
      {/* Header Banner */}
      <div className="bg-white rounded-2xl border border-[#e8e4dc] p-5 sm:p-6 shadow-2xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2.5">
              <span className="w-8 h-8 rounded-xl bg-[#0d1726] text-[#fdbe4e] flex items-center justify-center shadow-xs">
                <ShieldCheck className="w-5 h-5" />
              </span>
              <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 tracking-tight">
                Admin Panel & Permissions
              </h1>
            </div>
            <p className="text-sm text-slate-500 max-w-2xl">
              Control user accounts and role permissions for Moshi Urban Hostel. All changes take effect in real-time on the Firebase Firestore database and protect booking operations.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={handleSeedDefaults}
              disabled={isSeeding}
              className="flex items-center space-x-2 px-3.5 py-2.5 rounded-xl border border-[#e8e4dc] bg-[#faf8f5] hover:bg-slate-100 text-slate-700 text-xs font-semibold transition cursor-pointer"
              title="Populate or restore initial system roles in Firebase Firestore"
            >
              <Database className={`w-4 h-4 text-amber-600 ${isSeeding ? 'animate-spin' : ''}`} />
              <span>{isSeeding ? 'Syncing...' : 'Sync Default Roles to Firebase'}</span>
            </button>

            <button
              onClick={handleOpenAddModal}
              className="flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-[#fdbe4e] hover:bg-[#ebb043] text-[#0d1726] text-xs font-bold shadow-xs transition cursor-pointer"
            >
              <UserPlus className="w-4 h-4" />
              <span>Add New User</span>
            </button>
          </div>
        </div>

        {/* Database Status Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-[#f0ede6] text-xs text-slate-500">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse" />
            <span>Active Database: <strong className="font-mono text-slate-700">ai-studio-moshiurbanhostel-566fa31d</strong></span>
          </div>
          <div className="flex items-center space-x-1.5 text-slate-500">
            <span>Signed in Administrator:</span>
            <span className="font-mono font-semibold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-md">
              {currentUserEmail || 'Administrator'}
            </span>
          </div>
        </div>
      </div>

      {/* Role Counts KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white p-4 rounded-2xl border border-[#e8e4dc] shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span>Total Accounts</span>
            <Building className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900">{users.length}</div>
          <div className="text-[11px] text-slate-500">Configured in system</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-[#e8e4dc] shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-amber-700 text-xs font-medium">
            <span>1. Admins</span>
            <ShieldCheck className="w-4 h-4 text-[#fdbe4e]" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900">{adminCount}</div>
          <div className="text-[11px] text-slate-500">Full control over everything</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-[#e8e4dc] shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-blue-700 text-xs font-medium">
            <span>2. Property Managers</span>
            <KeyRound className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900">{managerCount}</div>
          <div className="text-[11px] text-slate-500">Bookings & change log undo</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-[#e8e4dc] shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-emerald-700 text-xs font-medium">
            <span>3. Staff</span>
            <Eye className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900">{staffCount}</div>
          <div className="text-[11px] text-slate-500">Overview & availability only</div>
        </div>
      </div>

      {/* Role Capabilities Guide (Apple HIG clear hierarchy) */}
      <div className="bg-gradient-to-r from-[#0d1726] to-[#162740] rounded-2xl p-5 text-white shadow-xs space-y-3">
        <div className="flex items-center space-x-2">
          <HelpCircle className="w-4 h-4 text-[#fdbe4e]" />
          <h2 className="text-sm font-semibold tracking-tight text-white">
            Permission Roles Matrix
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="bg-white/10 rounded-xl p-3 border border-white/10 space-y-1.5">
            <div className="flex items-center space-x-1.5 font-bold text-[#fdbe4e]">
              <ShieldCheck className="w-4 h-4" />
              <span>Admin</span>
            </div>
            <p className="text-slate-300 text-[11px] leading-relaxed">
              Full control over all PWA sections: overview, bookings, calendar, spreadsheet database, change log, undo, admin panel, and data wiping.
            </p>
            <div className="text-[10px] text-slate-400 font-mono">
              Defaults: wolfgodie, designkilifair, gdnjau
            </div>
          </div>

          <div className="bg-white/10 rounded-xl p-3 border border-white/10 space-y-1.5">
            <div className="flex items-center space-x-1.5 font-bold text-sky-300">
              <KeyRound className="w-4 h-4" />
              <span>Property Manager</span>
            </div>
            <p className="text-slate-300 text-[11px] leading-relaxed">
              Operational booking authority: create, edit, or delete bookings and undo changes via the Change Log. Cannot access Admin Panel or database settings.
            </p>
            <div className="text-[10px] text-slate-400 font-mono">
              Default: moshiurbanproperty@gmail.com
            </div>
          </div>

          <div className="bg-white/10 rounded-xl p-3 border border-white/10 space-y-1.5">
            <div className="flex items-center space-x-1.5 font-bold text-emerald-300">
              <Eye className="w-4 h-4" />
              <span>Staff</span>
            </div>
            <p className="text-slate-300 text-[11px] leading-relaxed">
              View-only front desk access: can only see the hostel room overview and availability calendar. Cannot edit bookings or access other panels.
            </p>
            <div className="text-[10px] text-slate-400 font-mono">
              Added by Admin only
            </div>
          </div>
        </div>
      </div>

      {/* Main User List Section */}
      <div className="bg-white rounded-2xl border border-[#e8e4dc] shadow-2xs overflow-hidden space-y-0">
        
        {/* Controls Toolbar */}
        <div className="p-4 border-b border-[#f0ede6] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-2">
            <span className="font-semibold text-slate-900 text-sm">Configured Accounts</span>
            <span className="text-xs text-slate-400 font-mono">({filteredUsers.length} of {users.length})</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search email or name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs bg-[#faf8f5] border border-[#e8e4dc] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#fdbe4e] w-48 sm:w-60"
              />
            </div>

            {/* Role Filter Tabs */}
            <div className="flex items-center bg-[#f5f2eb] p-0.5 rounded-xl border border-[#e8e4dc] text-xs font-medium">
              <button
                type="button"
                onClick={() => setRoleFilter('all')}
                className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                  roleFilter === 'all' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setRoleFilter('admin')}
                className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                  roleFilter === 'admin' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                Admins
              </button>
              <button
                type="button"
                onClick={() => setRoleFilter('manager')}
                className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                  roleFilter === 'manager' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                Managers
              </button>
              <button
                type="button"
                onClick={() => setRoleFilter('staff')}
                className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                  roleFilter === 'staff' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                Staff
              </button>
            </div>

            <button
              onClick={loadUsers}
              disabled={isLoading}
              className="p-1.5 rounded-xl border border-[#e8e4dc] hover:bg-slate-50 text-slate-600 transition cursor-pointer"
              title="Refresh users from Firestore"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-amber-600' : ''}`} />
            </button>
          </div>
        </div>

        {/* Table / List */}
        {isLoading ? (
          <div className="py-16 text-center space-y-3 bg-[#faf8f5]">
            <RefreshCw className="w-8 h-8 text-amber-600 animate-spin mx-auto" />
            <p className="text-sm font-semibold text-slate-800">Loading user accounts from Firestore...</p>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="py-16 text-center space-y-3 bg-[#faf8f5]">
            <Lock className="w-8 h-8 text-slate-400 mx-auto" />
            <p className="text-sm font-semibold text-slate-700">No user accounts found matching your query.</p>
            <button
              onClick={() => { setSearchQuery(''); setRoleFilter('all'); }}
              className="text-xs text-amber-600 font-semibold underline hover:text-amber-800"
            >
              Reset filters
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#faf8f5] text-slate-500 font-semibold border-b border-[#e8e4dc]">
                  <th className="py-3 px-4">User Account</th>
                  <th className="py-3 px-4">Assigned Role</th>
                  <th className="py-3 px-4">Permitted Operations</th>
                  <th className="py-3 px-4">Account Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0ede6]">
                {filteredUsers.map((account) => {
                  const isSystemLeadAdmin = account.email === 'designkilifair@gmail.com';
                  const isCurrentLoggedUser = currentUserEmail && account.email.toLowerCase() === currentUserEmail.toLowerCase();

                  return (
                    <tr key={account.email} className="hover:bg-[#fbf9f6] transition">
                      
                      {/* User Info */}
                      <td className="py-3 px-4">
                        <div className="flex items-center space-x-3">
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs ${
                            account.role === 'admin'
                              ? 'bg-[#0d1726] text-[#fdbe4e]'
                              : account.role === 'manager'
                              ? 'bg-sky-100 text-sky-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}>
                            {account.displayName?.charAt(0).toUpperCase() || account.email.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center space-x-1.5 flex-wrap">
                              <span className="font-semibold text-slate-900 truncate">
                                {account.displayName || account.email.split('@')[0]}
                              </span>
                              {isSystemLeadAdmin && (
                                <span className="px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-900 text-[10px] font-bold">
                                  Lead Admin
                                </span>
                              )}
                              {isCurrentLoggedUser && (
                                <span className="px-1.5 py-0.5 rounded-md bg-slate-200 text-slate-800 text-[10px] font-bold">
                                  You
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500 font-mono truncate">{account.email}</p>
                          </div>
                        </div>
                      </td>

                      {/* Role Badge */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        {account.role === 'admin' && (
                          <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-900 font-bold text-xs shadow-2xs">
                            <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
                            <span>Administrator</span>
                          </span>
                        )}
                        {account.role === 'manager' && (
                          <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-sky-50 border border-sky-200 text-sky-900 font-bold text-xs shadow-2xs">
                            <KeyRound className="w-3.5 h-3.5 text-sky-600" />
                            <span>Property Manager</span>
                          </span>
                        )}
                        {account.role === 'staff' && (
                          <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-900 font-bold text-xs shadow-2xs">
                            <Eye className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Staff (View-Only)</span>
                          </span>
                        )}
                      </td>

                      {/* Permissions Description */}
                      <td className="py-3 px-4 text-slate-600 text-xs">
                        {account.role === 'admin' && (
                          <span className="text-slate-700">Full system control, bookings, sheets, changelog & admin panel</span>
                        )}
                        {account.role === 'manager' && (
                          <span className="text-slate-700">Create, edit, delete bookings & undo changes via change log</span>
                        )}
                        {account.role === 'staff' && (
                          <span className="text-slate-500">View room overview and availability calendar only</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                          account.status === 'suspended'
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${account.status === 'suspended' ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                          <span className="capitalize">{account.status || 'active'}</span>
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end space-x-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(account)}
                            className="p-1.5 rounded-lg border border-[#e8e4dc] hover:bg-amber-50 hover:border-amber-300 text-slate-600 hover:text-amber-900 transition cursor-pointer"
                            title="Edit Role or Account Details"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => setDeletingUser(account)}
                            disabled={isSystemLeadAdmin || Boolean(isCurrentLoggedUser)}
                            className={`p-1.5 rounded-lg border transition ${
                              isSystemLeadAdmin || isCurrentLoggedUser
                                ? 'opacity-30 border-slate-200 text-slate-400 cursor-not-allowed'
                                : 'border-[#e8e4dc] hover:bg-rose-50 hover:border-rose-300 text-slate-600 hover:text-rose-700 cursor-pointer'
                            }`}
                            title={
                              isSystemLeadAdmin
                                ? 'Primary system administrator cannot be removed'
                                : isCurrentLoggedUser
                                ? 'You cannot delete your own active administrator account'
                                : 'Remove user account'
                            }
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit User Modal */}
      {(isAddModalOpen || editingUser) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-100">
          <div className="bg-white rounded-2xl border border-[#e8e4dc] shadow-xl max-w-lg w-full p-5 sm:p-6 space-y-4">
            
            <div className="flex items-center justify-between pb-3 border-b border-[#f0ede6]">
              <div className="flex items-center space-x-2">
                <span className="w-7 h-7 rounded-lg bg-[#0d1726] text-[#fdbe4e] flex items-center justify-center">
                  <ShieldCheck className="w-4 h-4" />
                </span>
                <h3 className="font-semibold text-slate-900 text-base">
                  {editingUser ? 'Edit User Role & Permissions' : 'Add New User Account'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => { setIsAddModalOpen(false); setEditingUser(null); }}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSaveUser} className="space-y-4">
              {/* Email Address */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-800">
                  Email Address (Google Account) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="email"
                  required
                  disabled={Boolean(editingUser)}
                  placeholder="e.g. staff.member@gmail.com"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-[#e8e4dc] bg-[#faf8f5] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#fdbe4e] disabled:opacity-60 disabled:cursor-not-allowed"
                />
                <p className="text-[11px] text-slate-400">
                  User will authenticate using Google Sign-in with this exact email address.
                </p>
              </div>

              {/* Display Name */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-800">
                  Full Name / Staff Title
                </label>
                <input
                  type="text"
                  placeholder="e.g. Sarah M. (Front Desk Lead)"
                  value={formDisplayName}
                  onChange={(e) => setFormDisplayName(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-[#e8e4dc] bg-[#faf8f5] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#fdbe4e]"
                />
              </div>

              {/* Role Selection */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-800">
                  Permission Role Level <span className="text-rose-500">*</span>
                </label>

                <div className="space-y-2">
                  {/* Admin Option */}
                  <label className={`flex items-start space-x-3 p-3 rounded-xl border transition cursor-pointer ${
                    formRole === 'admin'
                      ? 'border-slate-900 bg-amber-50/60 ring-1 ring-slate-900'
                      : 'border-[#e8e4dc] hover:bg-slate-50'
                  }`}>
                    <input
                      type="radio"
                      name="roleOption"
                      value="admin"
                      checked={formRole === 'admin'}
                      onChange={() => setFormRole('admin')}
                      className="mt-0.5 text-slate-900 focus:ring-[#fdbe4e]"
                    />
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center space-x-1.5 font-bold text-xs text-slate-900">
                        <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
                        <span>1. Admin</span>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Can control each and everything on the PWA (Overview, Bookings, Availability, Rooms, Sheets, Change Log, and Admin Panel).
                      </p>
                    </div>
                  </label>

                  {/* Property Manager Option */}
                  <label className={`flex items-start space-x-3 p-3 rounded-xl border transition cursor-pointer ${
                    formRole === 'manager'
                      ? 'border-slate-900 bg-sky-50/60 ring-1 ring-slate-900'
                      : 'border-[#e8e4dc] hover:bg-slate-50'
                  }`}>
                    <input
                      type="radio"
                      name="roleOption"
                      value="manager"
                      checked={formRole === 'manager'}
                      onChange={() => setFormRole('manager')}
                      className="mt-0.5 text-slate-900 focus:ring-[#fdbe4e]"
                    />
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center space-x-1.5 font-bold text-xs text-sky-900">
                        <KeyRound className="w-3.5 h-3.5 text-sky-600" />
                        <span>2. Property Manager</span>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Has access to create, edit or delete bookings and undo changes via the Change Log. Cannot access Admin Panel or database raw settings.
                      </p>
                    </div>
                  </label>

                  {/* Staff Option */}
                  <label className={`flex items-start space-x-3 p-3 rounded-xl border transition cursor-pointer ${
                    formRole === 'staff'
                      ? 'border-slate-900 bg-emerald-50/60 ring-1 ring-slate-900'
                      : 'border-[#e8e4dc] hover:bg-slate-50'
                  }`}>
                    <input
                      type="radio"
                      name="roleOption"
                      value="staff"
                      checked={formRole === 'staff'}
                      onChange={() => setFormRole('staff')}
                      className="mt-0.5 text-slate-900 focus:ring-[#fdbe4e]"
                    />
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center space-x-1.5 font-bold text-xs text-emerald-900">
                        <Eye className="w-3.5 h-3.5 text-emerald-600" />
                        <span>3. Staff</span>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Can only see the overview & availability of the rooms. View-only access with booking editing disabled.
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Account Status */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-800">
                  Account Status
                </label>
                <select
                  value={formStatus}
                  onChange={(e) => setFormStatus(e.target.value as 'active' | 'suspended')}
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-[#e8e4dc] bg-[#faf8f5] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#fdbe4e]"
                >
                  <option value="active">Active (Access Allowed)</option>
                  <option value="suspended">Suspended (Access Temporarily Revoked)</option>
                </select>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-[#f0ede6]">
                <button
                  type="button"
                  onClick={() => { setIsAddModalOpen(false); setEditingUser(null); }}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-[#fdbe4e] hover:bg-[#ebb043] text-[#0d1726] text-xs font-bold shadow-xs transition cursor-pointer disabled:opacity-60"
                >
                  {isSaving ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving to Firebase...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{editingUser ? 'Update Permissions' : 'Save User Account'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

      {/* Delete User Confirmation Modal */}
      {deletingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-100">
          <div className="bg-white rounded-2xl border border-[#e8e4dc] shadow-xl max-w-md w-full p-5 sm:p-6 space-y-4">
            <div className="flex items-center space-x-3 text-rose-600">
              <span className="w-10 h-10 rounded-full bg-rose-50 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-rose-600" />
              </span>
              <div>
                <h3 className="font-semibold text-slate-900 text-base">Remove User Access</h3>
                <p className="text-xs text-slate-500">This action will delete the account from Firebase.</p>
              </div>
            </div>

            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/60 text-xs space-y-1">
              <div><strong>Email:</strong> <span className="font-mono">{deletingUser.email}</span></div>
              <div><strong>Role:</strong> <span className="capitalize font-semibold">{deletingUser.role}</span></div>
              {deletingUser.displayName && <div><strong>Name:</strong> {deletingUser.displayName}</div>}
            </div>

            <p className="text-xs text-slate-500">
              The user will no longer possess their current permissions when accessing the hostel management system.
            </p>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setDeletingUser(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={handleDeleteUser}
                className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-xs transition cursor-pointer disabled:opacity-60"
              >
                {isSaving ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Removing...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Confirm Removal</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
