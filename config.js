// Deployment configuration. Keep mockMode true for local UI work.
// After `sam deploy`, add the stack outputs and set mockMode to false.
window.TICKET_CLUB_CONFIG = {
  mockMode: true,
  apiUrl: '',
  cognito: {
    userPoolId: '',
    userPoolClientId: '',
    region: ''
  }
};
