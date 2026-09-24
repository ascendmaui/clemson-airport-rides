/**
 * In-app account deletion starts a confirmed support ticket.
 * The privacy policy says deletion is requested through support.
 * This does not call auth.admin.deleteUser.
 */
export const ACCOUNT_DELETION_TICKET = Object.freeze({
  confirmed: true,
  category: 'account',
  roleVariant: 'rider',
  subject: 'Delete my Clemson RIDES account',
  body: 'Please delete my Clemson RIDES account and the trip history tied to it. I confirm this request from the product.',
})
