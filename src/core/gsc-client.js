// Google Search Console API client
import { google } from 'googleapis';
import fs from 'fs/promises';
import { createServer } from 'http';
import open from 'open';

export class GSCClient {
  constructor(credentialsPath) {
    this.credentialsPath = credentialsPath;
    this.auth = null;
    this.searchconsole = null;
  }

  async authenticate() {
    // Check if credentials exist
    try {
      const creds = JSON.parse(await fs.readFile(this.credentialsPath, 'utf-8'));
      this.auth = google.auth.fromJSON(creds);

      // Set credentials if it's an OAuth2 client
      if (this.auth.credentials) {
        await this.auth.getAccessToken(); // Verify token
      } else {
        // It's a stored token object
        const oauth2Client = new google.auth.OAuth2(
          process.env.GSC_CLIENT_ID,
          process.env.GSC_CLIENT_SECRET,
          'http://localhost:3000/oauth/callback'
        );
        oauth2Client.setCredentials(creds);
        this.auth = oauth2Client;
      }

      this.searchconsole = google.searchconsole({ version: 'v1', auth: this.auth });
      return true;
    } catch (err) {
      return false;
    }
  }

  async initiateOAuth() {
    if (!process.env.GSC_CLIENT_ID || !process.env.GSC_CLIENT_SECRET) {
      throw new Error('GSC_CLIENT_ID and GSC_CLIENT_SECRET must be set in environment');
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GSC_CLIENT_ID,
      process.env.GSC_CLIENT_SECRET,
      'http://localhost:3000/oauth/callback'
    );

    const scopes = ['https://www.googleapis.com/auth/webmasters.readonly'];
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
    });

    console.log('Opening browser for authentication...');
    await open(authUrl);

    // Start local server to receive callback
    const code = await new Promise((resolve) => {
      const server = createServer((req, res) => {
        if (req.url?.startsWith('/oauth/callback')) {
          const urlParams = new URL(req.url, 'http://localhost:3000').searchParams;
          const code = urlParams.get('code');
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>Authentication successful!</h1><p>You can close this window.</p>');
          server.close();
          resolve(code);
        }
      }).listen(3000);
    });

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Save credentials
    await fs.writeFile(this.credentialsPath, JSON.stringify(tokens, null, 2));

    this.auth = oauth2Client;
    this.searchconsole = google.searchconsole({ version: 'v1', auth: this.auth });
  }

  async getPagePerformance(siteUrl, startDate, endDate, dimensions = ['page']) {
    const response = await this.searchconsole.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate,
        endDate,
        dimensions,
        rowLimit: 25000,
      },
    });

    return response.data.rows || [];
  }

  async getPagePerformanceByPage(siteUrl, page, startDate, endDate) {
    const response = await this.searchconsole.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate,
        endDate,
        dimensions: ['page'],
        dimensionFilterGroups: [{
          filters: [{
            dimension: 'page',
            expression: page,
            operator: 'equals'
          }]
        }],
      },
    });

    return response.data.rows?.[0] || null;
  }
}
