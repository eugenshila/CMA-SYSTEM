
/**
 * Environment configuration with safe development defaults.
 */
export const env = {
  DATABASE_URL:
    process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5433/postgres',
  AUTH_SECRET: process.env.AUTH_SECRET || 'cma-dev-secret-change-me-please-32bytes!',
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || 'cma-dev-encryption-key-change-me-64hex00',
  APP_NAME: process.env.APP_NAME || 'CMA Management System',
  APP_URL: process.env.APP_URL || 'http://localhost:3000',
  isProduction: process.env.NODE_ENV === 'production',
  mpesa: {
    consumerKey: process.env.MPESA_CONSUMER_KEY || '',
    consumerSecret: process.env.MPESA_CONSUMER_SECRET || '',
    shortCode: process.env.MPESA_SHORT_CODE || '',
    passkey: process.env.MPESA_PASSKEY || '',
    baseUrl: process.env.MPESA_BASE_URL || 'https://sandbox.safaricom.co.ke',
    callbackUrl: process.env.MPESA_CALLBACK_URL || '',
  },
  storage: {
    cloudinaryUrl: process.env.CLOUDINARY_URL || '',
    s3Bucket: process.env.S3_BUCKET || '',
  },
};

/** Payment providers are considered configured only when real credentials exist. */
export const mpesaConfigured = () =>
  Boolean(env.mpesa.consumerKey && env.mpesa.consumerSecret && env.mpesa.shortCode && env.mpesa.passkey);
