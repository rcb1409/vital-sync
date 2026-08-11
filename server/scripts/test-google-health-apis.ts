/**
 * Google Health API Test Script
 * 
 * Tests all Google Health API endpoints to verify they're working
 * and returning data in the expected formats.
 * 
 * Run from server/ with:
 *   npx tsx scripts/test-google-health-apis.ts
 * 
 * Prerequisites:
 *   - Server must be running (npm run dev)
 *   - User must be logged in and have Google Health connected
 *   - Set TEST_USER_TOKEN env var or use the hardcoded test token
 */

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:4000';

// You'll need to get a valid JWT token from logging in
// Option 1: Set TEST_USER_TOKEN env var
// Option 2: Replace this with a valid token from your browser's localStorage
const AUTH_TOKEN = process.env.TEST_USER_TOKEN || '';

interface TestResult {
  endpoint: string;
  status: 'success' | 'error' | 'no_data';
  statusCode?: number;
  dataPointCount?: number;
  sampleData?: any;
  error?: string;
  responseTime?: number;
}

async function testEndpoint(
  name: string,
  endpoint: string,
  method: 'GET' | 'POST' = 'GET',
  body?: any
): Promise<TestResult> {
  const url = `${BASE_URL}${endpoint}`;
  const startTime = Date.now();
  
  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    
    const responseTime = Date.now() - startTime;
    const data = await response.json();
    
    if (!response.ok) {
      return {
        endpoint: name,
        status: 'error',
        statusCode: response.status,
        error: data.error || data.message || JSON.stringify(data),
        responseTime,
      };
    }
    
    // Check for data points
    const dataPoints = data.dataPoints ?? data.raw?.dataPoints ?? [];
    const count = dataPoints.length ?? data._meta?.dataPointCount ?? 0;
    
    return {
      endpoint: name,
      status: count > 0 ? 'success' : 'no_data',
      statusCode: response.status,
      dataPointCount: count,
      sampleData: dataPoints[0] ?? data,
      responseTime,
    };
  } catch (err: any) {
    return {
      endpoint: name,
      status: 'error',
      error: err.message,
      responseTime: Date.now() - startTime,
    };
  }
}

async function testGoogleHealthConnection(): Promise<TestResult> {
  return testEndpoint('Connection Status', '/api/google-health/status');
}

async function testExerciseData(): Promise<TestResult> {
  return testEndpoint('Exercise/Activity Data', '/api/google-health/test/raw-activity?days=30');
}

async function testSleepData(): Promise<TestResult> {
  return testEndpoint('Sleep Data', '/api/google-health/sleep?days=30');
}

async function testHeartRateData(): Promise<TestResult> {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return testEndpoint(
    'Heart Rate Data',
    `/api/google-health/test/raw-heart-rate?startDate=${yesterday.toISOString()}&endDate=${now.toISOString()}`
  );
}

// Test the new endpoints we added
async function testRestingHeartRateData(): Promise<TestResult> {
  const url = `${BASE_URL}/api/google-health/test/raw-resting-hr?days=30`;
  return testEndpoint('Resting Heart Rate', url);
}

async function testHRVData(): Promise<TestResult> {
  const url = `${BASE_URL}/api/google-health/test/raw-hrv?days=30`;
  return testEndpoint('HRV Data', url);
}

async function testVO2MaxData(): Promise<TestResult> {
  const url = `${BASE_URL}/api/google-health/test/raw-vo2max?days=30`;
  return testEndpoint('VO2 Max Data', url);
}

async function testStepsData(): Promise<TestResult> {
  const url = `${BASE_URL}/api/google-health/test/raw-steps?days=30`;
  return testEndpoint('Steps Data', url);
}

async function testSyncEndpoint(): Promise<TestResult> {
  return testEndpoint('Sync All Data', '/api/google-health/sync?days=7', 'POST');
}

function printResult(result: TestResult) {
  const statusEmoji = {
    success: '✅',
    error: '❌',
    no_data: '⚠️',
  };
  
  console.log(`\n${statusEmoji[result.status]} ${result.endpoint}`);
  console.log(`   Status: ${result.statusCode ?? 'N/A'}`);
  console.log(`   Response Time: ${result.responseTime}ms`);
  
  if (result.status === 'error') {
    console.log(`   Error: ${result.error}`);
  } else if (result.status === 'no_data') {
    console.log(`   Note: No data points returned (user may not have this data type)`);
  } else {
    console.log(`   Data Points: ${result.dataPointCount}`);
    if (result.sampleData) {
      console.log(`   Sample Data Structure:`);
      console.log(`   ${JSON.stringify(result.sampleData, null, 2).split('\n').join('\n   ')}`);
    }
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('           Google Health API Test Suite');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`\nBase URL: ${BASE_URL}`);
  console.log(`Auth Token: ${AUTH_TOKEN ? AUTH_TOKEN.substring(0, 20) + '...' : '❌ NOT SET'}`);
  
  if (!AUTH_TOKEN) {
    console.log('\n❌ ERROR: No auth token provided.');
    console.log('   Set TEST_USER_TOKEN environment variable or edit the script.');
    console.log('   To get a token:');
    console.log('   1. Log in to VitalSync in your browser');
    console.log('   2. Open DevTools → Application → Local Storage');
    console.log('   3. Copy the "token" value');
    process.exit(1);
  }
  
  console.log('\n───────────────────────────────────────────────────────────────');
  console.log('Testing Existing Endpoints');
  console.log('───────────────────────────────────────────────────────────────');
  
  // Test connection status first
  const connectionResult = await testGoogleHealthConnection();
  printResult(connectionResult);
  
  if (connectionResult.status === 'error') {
    console.log('\n❌ Cannot proceed - Google Health not connected or auth failed');
    process.exit(1);
  }
  
  // Test existing endpoints
  const existingResults = await Promise.all([
    testExerciseData(),
    testSleepData(),
    testHeartRateData(),
  ]);
  
  existingResults.forEach(printResult);
  
  console.log('\n───────────────────────────────────────────────────────────────');
  console.log('Testing NEW Endpoints (HRV, Resting HR, VO2 Max, Steps)');
  console.log('───────────────────────────────────────────────────────────────');
  
  // Test new endpoints - these will fail until we add the routes
  const newResults = await Promise.all([
    testRestingHeartRateData(),
    testHRVData(),
    testVO2MaxData(),
    testStepsData(),
  ]);
  
  newResults.forEach(printResult);
  
  console.log('\n───────────────────────────────────────────────────────────────');
  console.log('Testing Sync Endpoint');
  console.log('───────────────────────────────────────────────────────────────');
  
  const syncResult = await testSyncEndpoint();
  printResult(syncResult);
  
  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                        SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  
  const allResults = [connectionResult, ...existingResults, ...newResults, syncResult];
  const successCount = allResults.filter(r => r.status === 'success').length;
  const errorCount = allResults.filter(r => r.status === 'error').length;
  const noDataCount = allResults.filter(r => r.status === 'no_data').length;
  
  console.log(`\n   ✅ Success:  ${successCount}`);
  console.log(`   ❌ Errors:   ${errorCount}`);
  console.log(`   ⚠️  No Data: ${noDataCount}`);
  console.log(`   Total:      ${allResults.length}`);
  
  if (errorCount > 0) {
    console.log('\n⚠️  Some endpoints failed. Check the errors above.');
    console.log('   New endpoints (HRV, RHR, VO2, Steps) need test routes to be added.');
  }
  
  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
