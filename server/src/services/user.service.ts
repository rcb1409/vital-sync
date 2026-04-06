import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_GOALS = {
    weightKg: 75,
    calories: 2500,
    proteinG: 150,
    sleepHours: 8,
    waterMl: 4000
};

async function getProfile(userId: string) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true, goals: true, aiMemory: true }
    });
    if (!user) throw new Error('User not found');
    // Merge in defaults if goals are empty
    const goals = user.goals || DEFAULT_GOALS;
    return { ...user, goals };
}

async function updateProfile(userId: string, data: { name?: string, goals?: any, aiMemory?: any }) {
    const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
            ...(data.name && { name: data.name }),
            ...(data.goals && { goals: data.goals }),
            ...(data.aiMemory && { aiMemory: data.aiMemory })
        },
        select: { id: true, name: true, email: true, goals: true, aiMemory: true }
    });
    return updatedUser;
}

export const userService = {
    getProfile,
    updateProfile
};