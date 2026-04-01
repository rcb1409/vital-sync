import axios from 'axios';
import { prisma } from '../config/database';

// Helper to convert speed (meters/sec) to pace (seconds/km)
const speedToPace = (metersPerSec: number): number => {
    if (!metersPerSec || metersPerSec <= 0) return 0;
    // 1 km = 1000m. 
    // Time for 1km = 1000 / speed
    return Math.round(1000 / metersPerSec);
};

async function connectStravaAccount(userId: string, code: string) {
    // 1. Exchange the Authorization Code for an Access Token
    const tokenResponse = await axios.post('https://www.strava.com/api/v3/oauth/token', {
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        code: code,
        grant_type: 'authorization_code'
    });

    const { access_token, refresh_token, expires_at, athlete } = tokenResponse.data;

    // 2. Save it to our database
    await prisma.stravaAccount.upsert({
        where: { userId },
        update: {
            stravaAthleteId: athlete.id,
            accessToken: access_token,
            refreshToken: refresh_token,
            tokenExpiresAt: new Date(expires_at * 1000), // Strava returns epoch seconds
        },
        create: {
            userId,
            stravaAthleteId: athlete.id,
            accessToken: access_token,
            refreshToken: refresh_token,
            tokenExpiresAt: new Date(expires_at * 1000),
        }
    });
}

async function getValidAccessToken(userId: string): Promise<string> {
    const account = await prisma.stravaAccount.findUnique({ where: { userId } });
    if (!account) throw new Error("Strava not connected");

    // If token expires in less than 5 minutes, refresh it!
    if (account.tokenExpiresAt.getTime() < Date.now() + 5 * 60 * 1000) {
        const refreshResponse = await axios.post('https://www.strava.com/api/v3/oauth/token', {
            client_id: process.env.STRAVA_CLIENT_ID,
            client_secret: process.env.STRAVA_CLIENT_SECRET,
            grant_type: 'refresh_token',
            refresh_token: account.refreshToken
        });

        const { access_token, refresh_token, expires_at } = refreshResponse.data;

        await prisma.stravaAccount.update({
            where: { userId },
            data: {
                accessToken: access_token,
                refreshToken: refresh_token,
                tokenExpiresAt: new Date(expires_at * 1000)
            }
        });

        return access_token;
    }

    return account.accessToken;
}

async function syncRecentActivities(userId: string) {
    const accessToken = await getValidAccessToken(userId);

    // Fetch last 30 activities
    const response = await axios.get('https://www.strava.com/api/v3/athlete/activities?per_page=30', {
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    let syncCount = 0;

    for (const activity of response.data) {
        // YOU ARE TOTALLY RIGHT! WE REMOVED THE `activity.type === 'Run'` CHECK!
        // Now it syncs walks, swims, rides, everything!

        const startTime = new Date(activity.start_date);

        // Upsert ensures we don't create duplicates if they hit sync multiple times
        await prisma.runActivity.upsert({
            where: { stravaActivityId: BigInt(activity.id) },
            update: {
                distanceM: Math.round(activity.distance),
                movingTimeS: activity.moving_time,
                elevationGainM: Math.round(activity.total_elevation_gain || 0),
                averagePaceSPerKm: speedToPace(activity.average_speed),
                raw: activity // We save the raw JSON so we know the type (Ride, Walk, etc) later!
            },
            create: {
                userId,
                stravaActivityId: BigInt(activity.id),
                source: 'strava',
                startTime: startTime,
                distanceM: Math.round(activity.distance),
                movingTimeS: activity.moving_time,
                elevationGainM: Math.round(activity.total_elevation_gain || 0),
                averagePaceSPerKm: speedToPace(activity.average_speed),
                raw: activity // Contains activity.type
            }
        });
        syncCount++;
    }

    return { synced: syncCount };
}

async function getActivitiesHistory(userId: string) {
    // This will return all synced activities (Walk, Ride, Run, etc)
    const history = await prisma.runActivity.findMany({
        where: { userId },
        orderBy: { startTime: 'desc' }
    });

    // Fix the infamous Node.js "TypeError: Do not know how to serialize a BigInt" error
    // by manually casting the BigInt to a string before JSON.stringify takes it
    return history.map(run => ({
        ...run,
        stravaActivityId: run.stravaActivityId ? run.stravaActivityId.toString() : null
    }));
}

export const runService = {
    connectStravaAccount,
    syncRecentActivities,
    getActivitiesHistory,
};
