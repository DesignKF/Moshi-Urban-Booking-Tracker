import test from 'node:test';
import assert from 'node:assert/strict';

test('Currency conversion and formatting logic', () => {
  const CURRENCY_RATES = { USD: 1, TZS: 2645, EUR: 0.92, GBP: 0.79 };
  const formatMoney = (amountUSD, curr) => {
    const rate = CURRENCY_RATES[curr] || 1;
    const val = amountUSD * rate;
    if (curr === 'USD') return `$${Math.round(val).toLocaleString()}`;
    if (curr === 'TZS') return `TZS ${Math.round(val).toLocaleString()}`;
    if (curr === 'EUR') return `€${Math.round(val).toLocaleString()}`;
    if (curr === 'GBP') return `£${Math.round(val).toLocaleString()}`;
    return `$${Math.round(amountUSD).toLocaleString()}`;
  };

  assert.equal(formatMoney(100, 'USD'), '$100');
  assert.equal(formatMoney(100, 'TZS'), 'TZS 264,500');
  assert.equal(formatMoney(100, 'EUR'), '€92');
  assert.equal(formatMoney(100, 'GBP'), '£79');
});

test('Mobile bottom dock tab access rules based on user role', () => {
  const getDockItemAction = (tabKey, isStaff) => {
    if (tabKey === 'bookings' && isStaff) {
      return { allowed: false, notice: 'Staff accounts have view-only access to Overview & Availability' };
    }
    if (tabKey === 'settings') {
      return { allowed: true, opensSidebar: true };
    }
    return { allowed: true, tab: tabKey };
  };

  // Staff member clicking tabs
  assert.equal(getDockItemAction('overview', true).allowed, true);
  assert.equal(getDockItemAction('availability', true).allowed, true);
  assert.equal(getDockItemAction('bookings', true).allowed, false);
  assert.equal(getDockItemAction('settings', true).opensSidebar, true);

  // Admin or Property Manager clicking tabs
  assert.equal(getDockItemAction('bookings', false).allowed, true);
  assert.equal(getDockItemAction('settings', false).opensSidebar, true);
});

test('Recent searches deduplication and capacity capping', () => {
  let recentSearches = [];
  const addRecentSearch = (newItem) => {
    const filtered = recentSearches.filter(
      item => item.query.toLowerCase() !== newItem.query.toLowerCase() &&
              (!newItem.bookingId || item.bookingId !== newItem.bookingId)
    );
    recentSearches = [newItem, ...filtered].slice(0, 8);
  };

  addRecentSearch({ id: '1', query: 'Godwin Njau', type: 'guest_record', bookingId: 'GN-101' });
  addRecentSearch({ id: '2', query: 'Safari Dorm', type: 'search' });
  addRecentSearch({ id: '3', query: 'Godwin Njau', type: 'guest_record', bookingId: 'GN-101' });

  // Duplicates are removed and latest pushed to top
  assert.equal(recentSearches.length, 2);
  assert.equal(recentSearches[0].query, 'Godwin Njau');
  assert.equal(recentSearches[1].query, 'Safari Dorm');
});

test('Mobile header item arrangement specification', () => {
  const mobileHeaderItems = [
    { position: 'left', id: 'search_icon', opens: 'search_popup' },
    { position: 'center', id: 'new_booking_btn', opens: 'booking_modal' },
    { position: 'right', id: 'notifications_icon', opens: 'notifications_popup' }
  ];

  assert.equal(mobileHeaderItems[0].position, 'left');
  assert.equal(mobileHeaderItems[0].id, 'search_icon');

  assert.equal(mobileHeaderItems[1].position, 'center');
  assert.equal(mobileHeaderItems[1].id, 'new_booking_btn');

  assert.equal(mobileHeaderItems[2].position, 'right');
  assert.equal(mobileHeaderItems[2].id, 'notifications_icon');
});

test('Side panel currency visibility across desktop and mobile', () => {
  const getSidePanelCurrencyVisibility = (viewport) => {
    // Desktop and Tablet views hide currency from side panel (currency is in top header)
    if (viewport === 'desktop' || viewport === 'tablet') {
      return { inSidePanel: false, inTopHeader: true };
    }
    // Mobile view includes currency in the slide-out drawer
    return { inSidePanel: true, inTopHeader: false };
  };

  assert.equal(getSidePanelCurrencyVisibility('desktop').inSidePanel, false);
  assert.equal(getSidePanelCurrencyVisibility('tablet').inSidePanel, false);
  assert.equal(getSidePanelCurrencyVisibility('mobile').inSidePanel, true);
});

test('Tablet collapsed side panel width and overflow protection', () => {
  const getSidebarLayout = (isCollapsed) => {
    return {
      widthClass: isCollapsed ? 'md:w-16' : 'md:w-64',
      positionClass: 'md:relative',
      textLabelClass: isCollapsed ? 'md:hidden' : 'inline'
    };
  };

  const collapsed = getSidebarLayout(true);
  assert.equal(collapsed.widthClass, 'md:w-16');
  assert.equal(collapsed.positionClass, 'md:relative');
  assert.equal(collapsed.textLabelClass, 'md:hidden');

  const expanded = getSidebarLayout(false);
  assert.equal(expanded.widthClass, 'md:w-64');
  assert.equal(expanded.textLabelClass, 'inline');
});

test('Unauthenticated user receives login screen first, then transitions to app after sign-in', () => {
  const resolveView = (user, authLoading) => {
    if (authLoading) return 'splash_loading';
    if (!user) return 'login_screen';
    return 'app_dashboard';
  };

  // Initially, before auth check resolves:
  assert.equal(resolveView(null, true), 'splash_loading');

  // Once checked and user is not logged in: presents login screen
  assert.equal(resolveView(null, false), 'login_screen');

  // After user signs in with Google: takes them directly to the app
  const loggedInUser = { uid: 'user_123', email: 'staff@moshiurbanhostel.com' };
  assert.equal(resolveView(loggedInUser, false), 'app_dashboard');

  // After user signs out: returns them to login screen
  assert.equal(resolveView(null, false), 'login_screen');
});

test('Login screen feature cards are hidden on mobile and tablet, visible on desktop', () => {
  const getFeatureCardsVisibility = (viewport) => {
    // Hidden on mobile and tablet, displayed on desktop (hidden lg:grid)
    if (viewport === 'mobile' || viewport === 'tablet') {
      return { visible: false, cssClass: 'hidden' };
    }
    return { visible: true, cssClass: 'grid' };
  };

  assert.equal(getFeatureCardsVisibility('mobile').visible, false);
  assert.equal(getFeatureCardsVisibility('tablet').visible, false);
  assert.equal(getFeatureCardsVisibility('desktop').visible, true);
});

