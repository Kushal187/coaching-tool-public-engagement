// lambda/admin-basic-auth.mjs
// Lambda authorizer for Basic Auth on /api/admin/* routes.
// Extracts Authorization header, decodes Base64 Basic Auth credentials,
// and compares against Secrets Manager coaching-tool/admin-credentials.
// Returns IAM policy Allow/Deny.

let cachedCredentials = null;

async function loadCredentials() {
  if (cachedCredentials) return cachedCredentials;

  // In Lambda, use the Secrets Manager Lambda Extension
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const token = process.env.AWS_SESSION_TOKEN;
    const secretId = 'coaching-tool/admin-credentials';

    try {
      const resp = await fetch(
        `http://localhost:2773/secretsmanager/get?secretId=${encodeURIComponent(secretId)}`,
        { headers: { 'X-Aws-Parameters-Secrets-Token': token } },
      );

      if (!resp.ok) {
        throw new Error(`Secrets Manager returned ${resp.status}`);
      }

      const data = await resp.json();
      cachedCredentials = JSON.parse(data.SecretString);
      return cachedCredentials;
    } catch (err) {
      console.error('Failed to load admin credentials from Secrets Manager:', err.message);

      // Fallback to environment variables
      if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
        cachedCredentials = {
          username: process.env.ADMIN_USERNAME,
          password: process.env.ADMIN_PASSWORD,
        };
        return cachedCredentials;
      }

      throw err;
    }
  }

  // Local development: use environment variables
  cachedCredentials = {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'admin',
  };
  return cachedCredentials;
}

function generatePolicy(principalId, effect, resource) {
  const policy = {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: effect,
          Resource: resource,
        },
      ],
    },
  };
  return policy;
}

function extractMethodArn(event) {
  // For REST API (v1), the methodArn is directly on the event
  if (event.methodArn) {
    return event.methodArn;
  }

  // For HTTP API (v2), construct a wildcard ARN
  if (event.routeArn) {
    // routeArn format: arn:aws:execute-api:region:account:api-id/stage/method/path
    // Convert to wildcard to allow all admin routes
    const parts = event.routeArn.split('/');
    return `${parts[0]}/${parts[1]}/*`;
  }

  // Fallback wildcard
  return '*';
}

export const handler = async (event) => {
  const authHeader =
    event.authorizationToken ||                    // REST API v1 TOKEN authorizer
    event.headers?.authorization ||                // HTTP API v2 payload format
    event.headers?.Authorization ||                // case-insensitive fallback
    '';

  const methodArn = extractMethodArn(event);

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    console.log('[auth] Missing or invalid Authorization header');
    return generatePolicy('anonymous', 'Deny', methodArn);
  }

  try {
    const encoded = authHeader.slice(6); // Remove "Basic "
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    const colonIndex = decoded.indexOf(':');

    if (colonIndex === -1) {
      console.log('[auth] Malformed credentials (no colon separator)');
      return generatePolicy('anonymous', 'Deny', methodArn);
    }

    const username = decoded.slice(0, colonIndex);
    const password = decoded.slice(colonIndex + 1);

    const credentials = await loadCredentials();

    if (username === credentials.username && password === credentials.password) {
      console.log(`[auth] Authorized: ${username}`);
      // Allow all methods/routes under this API stage
      const wildcardArn = methodArn.replace(/\/[^/]+\/[^/]+$/, '/*');
      return generatePolicy(username, 'Allow', wildcardArn);
    }

    console.log(`[auth] Invalid credentials for user: ${username}`);
    return generatePolicy(username, 'Deny', methodArn);
  } catch (error) {
    console.error('[auth] Authorization error:', error);
    return generatePolicy('error', 'Deny', methodArn);
  }
};
