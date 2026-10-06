# Ticket Club

The front end runs as an interactive mock by default and can use the deployed Cognito-protected API when configured. Its serverless foundation is defined in `infra/template.yaml`:

- Amazon Cognito authenticates coaches.
- API Gateway invokes one Python Lambda function.
- The Lambda maintains an S3 state snapshot and writes each ticket change as an immutable event object.
- A private S3 bucket and CloudFront Origin Access Control serve the web app over HTTPS.

## Local mock preview

Copy the committed configuration template before opening the app:

```powershell
Copy-Item config.example.js config.js
```

Open `index.html`, or run:

```powershell
python -m http.server 8080
```

Then browse to `http://localhost:8080`.

## AWS deployment

This uses the AWS SAM CLI. From the repository root:

```powershell
sam build --template-file infra/template.yaml
sam deploy --guided
```

Upload the front-end files and a non-committed `config.js` to the `SiteBucketName` output after deployment. Start with `config.example.js`, then update `config.js` with the `ApiUrl`, `UserPoolId`, `UserPoolClientId`, and AWS Region outputs, and set `mockMode` to `false`:

```js
window.TICKET_CLUB_CONFIG = {
  mockMode: false,
  apiUrl: 'https://your-api-id.execute-api.your-region.amazonaws.com',
  cognito: {
    userPoolId: 'your-user-pool-id',
    userPoolClientId: 'your-user-pool-client-id',
    region: 'your-region'
  }
};
```

Create each coach in the Cognito User Pool after deployment. They will sign in with their email and temporary password, then be prompted to choose a permanent password.

`config.js` is a browser-visible runtime file, so it must never contain AWS access keys, passwords, tokens, or a Cognito client secret. The User Pool client in this project is intentionally public and has no client secret.

The template keeps both buckets private. It does not create RDS or DynamoDB resources.
