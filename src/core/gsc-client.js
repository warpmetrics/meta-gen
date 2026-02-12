// Google Search Console API client
import { google } from 'googleapis';
import fs from 'fs/promises';
import { createServer } from 'http';
import open from 'open';

export function createGSCClient(credentialsPath) {
  let auth = null;
  let searchconsole = null;

  async function authenticate() {
    try {
      const creds = JSON.parse(await fs.readFile(credentialsPath, 'utf-8'));

      if (!process.env.GSC_CLIENT_ID || !process.env.GSC_CLIENT_SECRET) {
        throw new Error('GSC_CLIENT_ID and GSC_CLIENT_SECRET environment variables must be set');
      }

      const oauth2Client = new google.auth.OAuth2(
        process.env.GSC_CLIENT_ID,
        process.env.GSC_CLIENT_SECRET,
        'http://localhost:3456/oauth/callback'
      );
      oauth2Client.setCredentials(creds);

      await oauth2Client.getAccessToken();

      auth = oauth2Client;
      searchconsole = google.searchconsole({ version: 'v1', auth });
      return true;
    } catch (err) {
      console.error('Authentication error:', err.message);
      throw err;
    }
  }

  async function initiateOAuth() {
    if (!process.env.GSC_CLIENT_ID || !process.env.GSC_CLIENT_SECRET) {
      throw new Error('GSC_CLIENT_ID and GSC_CLIENT_SECRET must be set in environment');
    }

    const CALLBACK_PORT = 3456;
    const oauth2Client = new google.auth.OAuth2(
      process.env.GSC_CLIENT_ID,
      process.env.GSC_CLIENT_SECRET,
      `http://localhost:${CALLBACK_PORT}/oauth/callback`
    );

    const scopes = ['https://www.googleapis.com/auth/webmasters.readonly'];
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
    });

    console.log('Opening browser for authentication...');
    await open(authUrl);

    const code = await new Promise((resolve) => {
      const server = createServer((req, res) => {
        if (req.url?.startsWith('/oauth/callback')) {
          const urlParams = new URL(req.url, `http://localhost:${CALLBACK_PORT}`).searchParams;
          const code = urlParams.get('code');
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>Authentication successful!</h1><p>You can close this window.</p>');
          server.close();
          resolve(code);
        }
      }).listen(CALLBACK_PORT);
    });

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    await fs.writeFile(credentialsPath, JSON.stringify(tokens, null, 2));

    auth = oauth2Client;
    searchconsole = google.searchconsole({ version: 'v1', auth });
  }

  async function getPagePerformance(siteUrl, startDate, endDate, dimensions = ['page']) {
    const response = await searchconsole.searchanalytics.query({
      siteUrl,
      requestBody: { startDate, endDate, dimensions, rowLimit: 25000 },
    });
    return response.data.rows || [];
  }

  async function getPagePerformanceByPage(siteUrl, page, startDate, endDate) {
    const response = await searchconsole.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate,
        endDate,
        dimensions: ['page'],
        dimensionFilterGroups: [{
          filters: [{ dimension: 'page', expression: page, operator: 'equals' }]
        }],
      },
    });
    return response.data.rows?.[0] || null;
  }

  return { authenticate, initiateOAuth, getPagePerformance, getPagePerformanceByPage };
}
