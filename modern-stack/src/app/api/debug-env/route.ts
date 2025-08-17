import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    signal: {
      SIGNAL_CLI_REST_API_BASE_URL: process.env.SIGNAL_CLI_REST_API_BASE_URL || 'NOT SET',
      SIGNAL_BOT_PHONE_NUMBER: process.env.SIGNAL_BOT_PHONE_NUMBER || 'NOT SET',
      SIGNAL_ACTIVE: process.env.SIGNAL_ACTIVE || 'NOT SET',
    },
    matrix: {
      MATRIX_HOMESERVER: process.env.MATRIX_HOMESERVER || 'NOT SET',
      MATRIX_ACCESS_TOKEN: process.env.MATRIX_ACCESS_TOKEN ? 'SET' : 'NOT SET',
      MATRIX_USER_ID: process.env.MATRIX_USER_ID || 'NOT SET',
      MATRIX_ACTIVE: process.env.MATRIX_ACTIVE || 'NOT SET',
    },
    checks: {
      signalConfigured: !!(process.env.SIGNAL_CLI_REST_API_BASE_URL && process.env.SIGNAL_BOT_PHONE_NUMBER),
      matrixConfigured: !!(process.env.MATRIX_HOMESERVER && process.env.MATRIX_ACCESS_TOKEN && process.env.MATRIX_USER_ID),
    }
  });
}