// Development deployment configuration. Cognito and the API are provisioned by the
// math-club-ticketing-dev CloudFormation stack in us-west-2.
window.TICKET_CLUB_CONFIG = {
  mockMode: false,
  apiUrl: 'https://9xh5cby9x4.execute-api.us-west-2.amazonaws.com',
  cognito: {
    userPoolId: 'us-west-2_QZOTkSl5i',
    userPoolClientId: '209tokuchqj1n95s178nj7amh6',
    region: 'us-west-2'
  }
};
