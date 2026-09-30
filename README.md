# Ticket Club

The current front end is an interactive mock that runs as a static site. Its serverless foundation is defined in `infra/template.yaml`:

- Amazon Cognito authenticates coaches.
- API Gateway invokes one Python Lambda function.
- The Lambda maintains an S3 state snapshot and writes each ticket change as an immutable event object.
- A private S3 bucket and CloudFront Origin Access Control serve the web app over HTTPS.

## Local mock preview

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

Upload the front-end files to the `SiteBucketName` output after deployment. Populate `config.js` with the `ApiUrl`, `UserPoolId`, `UserPoolClientId`, and AWS Region outputs, then set `mockMode` to `false` when the next front-end integration step is completed.

The template keeps both buckets private. It does not create RDS or DynamoDB resources.
