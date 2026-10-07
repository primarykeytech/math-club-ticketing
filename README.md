# Ticket Club

Ticket Club is a small web app for math-club coaches to award virtual tickets, manage a prize shop, and keep an auditable ticket history. It is designed for a low-cost, serverless AWS deployment: static files are served through CloudFront and all application data is stored in S3. It does not use RDS or DynamoDB.

## Current features

### Ticket board

- Displays active students alphabetically, with their current ticket balances.
- Provides Quick Add buttons for **+1**, **+5**, **+10**, and **+20** tickets.
- Supports a custom ticket award with a required note.
- Supports **Award all students**, which gives every active student the same number of tickets and note (for example, 20 tickets for “Completed practice test”). Each student receives their own history entry.
- Shows simple at-a-glance counts for active students, tickets awarded, and available prize inventory.

### Students and prizes

- Add students in grades 2 through 8.
- Search the student roster, which is alphabetically ordered by default.
- Deactivate students without deleting their ticket history; reactivate them when needed.
- Add prizes with a ticket cost and stock quantity.
- Redeem prizes for active students when they have enough tickets and the prize is in stock.

### History and security

- Records ticket additions and prize redemptions as individual ledger events.
- Filters history by student and activity type.
- Exports the visible ticket-history ledger as a CSV file.
- Uses Amazon Cognito for coach sign-in, initial temporary-password replacement, and token refresh.
- Uses a private, versioned S3 data bucket for the current state and event records.
- Serves the web app over HTTPS through CloudFront, with the website bucket kept private through Origin Access Control.

## Project layout

| Path | Purpose |
| --- | --- |
| `index.html`, `app.css`, `app.js` | Static browser application |
| `config.example.js` | Safe template for the browser runtime configuration |
| `config.js` | Local/deployed runtime configuration; intentionally ignored by Git |
| `backend/app.py` | Python Lambda API backed by S3 |
| `backend/requirements.txt` | Python dependency list |
| `infra/template.yaml` | AWS SAM/CloudFormation infrastructure template |

## Local mock preview

The committed configuration template starts the application in mock-data mode. Copy it before opening the app:

```powershell
Copy-Item config.example.js config.js
python -m http.server 8080
```

Then open `http://localhost:8080`. In mock mode, all changes remain in the current browser session.

## AWS architecture

The CloudFormation template creates:

- An Amazon Cognito User Pool and public browser client for coach accounts.
- An HTTP API Gateway endpoint protected by Cognito JWT authorization.
- One Python Lambda function for students, prizes, awards, bulk awards, redemptions, and history.
- A private, versioned S3 data bucket. It stores a current state snapshot plus one immutable JSON object for each ledger event.
- A private S3 site bucket and CloudFront distribution with Origin Access Control.

## Deployment

Configure AWS CLI SSO first, then deploy the infrastructure from the repository root. SAM CLI can deploy the template directly; the equivalent AWS CLI workflow below is useful when SAM is not installed.

```powershell
$profile = 'your-sso-profile'
$region = 'us-west-2'
$stack = 'ticket-club-dev'
$artifacts = 'your-unique-artifact-bucket'

aws cloudformation package `
  --template-file infra/template.yaml `
  --s3-bucket $artifacts `
  --output-template-file infra/packaged-template.yaml `
  --region $region --profile $profile

aws cloudformation deploy `
  --template-file infra/packaged-template.yaml `
  --stack-name $stack `
  --capabilities CAPABILITY_IAM `
  --region $region --profile $profile
```

After the stack completes, retrieve its `SiteBucketName`, `ApiUrl`, `UserPoolId`, and `UserPoolClientId` outputs. Create a local `config.js` from `config.example.js`, set `mockMode` to `false`, and fill in those values:

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

Upload the static assets to the site bucket, then invalidate CloudFront after each frontend change:

```powershell
aws s3 cp index.html "s3://YOUR_SITE_BUCKET/index.html" --content-type text/html --cache-control no-cache --profile $profile
aws s3 cp app.css "s3://YOUR_SITE_BUCKET/app.css" --content-type text/css --cache-control no-cache --profile $profile
aws s3 cp app.js "s3://YOUR_SITE_BUCKET/app.js" --content-type text/javascript --cache-control no-cache --profile $profile
aws s3 cp config.js "s3://YOUR_SITE_BUCKET/config.js" --content-type text/javascript --cache-control no-cache --profile $profile
aws cloudfront create-invalidation --distribution-id YOUR_DISTRIBUTION_ID --paths '/index.html' '/app.js' '/app.css' '/config.js' --profile $profile
```

`config.js` is browser-visible configuration, not a secret. Never put AWS access keys, passwords, tokens, or a Cognito client secret in it. The User Pool client for this application intentionally has no client secret.

## Coach accounts

Create coach accounts in the deployed Cognito User Pool. Each coach signs in with their email and temporary password, then chooses a permanent password on first use. Student records are created and managed within the application; they do not need Cognito accounts.
