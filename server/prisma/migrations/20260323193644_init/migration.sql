-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `password_hash` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `goals` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exercises` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `muscle_group` ENUM('chest', 'back', 'shoulders', 'biceps', 'triceps', 'legs', 'core', 'cardio') NOT NULL,
    `equipment` ENUM('barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'other') NOT NULL,
    `user_id` VARCHAR(191) NULL,

    INDEX `exercises_muscle_group_idx`(`muscle_group`),
    INDEX `exercises_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workouts` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `started_at` DATETIME(3) NOT NULL,
    `duration_min` INTEGER NULL,
    `notes` TEXT NULL,

    INDEX `workouts_user_id_started_at_idx`(`user_id`, `started_at` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workout_sets` (
    `id` VARCHAR(191) NOT NULL,
    `workout_id` VARCHAR(191) NOT NULL,
    `exercise_id` INTEGER NOT NULL,
    `set_number` INTEGER NOT NULL,
    `reps` INTEGER NOT NULL,
    `weight_kg` DECIMAL(6, 2) NOT NULL,
    `rpe` INTEGER NULL,
    `is_pr` BOOLEAN NOT NULL DEFAULT false,

    INDEX `workout_sets_workout_id_idx`(`workout_id`),
    INDEX `workout_sets_exercise_id_idx`(`exercise_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workout_templates` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `exercises` JSON NOT NULL,

    INDEX `workout_templates_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `nutrition_logs` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `food_name` VARCHAR(191) NOT NULL,
    `calories` INTEGER NOT NULL,
    `protein_g` DECIMAL(6, 2) NOT NULL,
    `carbs_g` DECIMAL(6, 2) NOT NULL,
    `fat_g` DECIMAL(6, 2) NOT NULL,
    `meal_type` ENUM('breakfast', 'lunch', 'dinner', 'snack') NOT NULL,
    `is_saved_meal` BOOLEAN NOT NULL DEFAULT false,
    `date` DATE NOT NULL,

    INDEX `nutrition_logs_user_id_date_idx`(`user_id`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `body_metrics` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `weight_kg` DECIMAL(5, 2) NOT NULL,
    `date` DATE NOT NULL,

    INDEX `body_metrics_user_id_date_idx`(`user_id`, `date` DESC),
    UNIQUE INDEX `body_metrics_user_id_date_key`(`user_id`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `daily_habits` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `sleep_hours` DECIMAL(3, 1) NOT NULL,
    `sleep_quality` INTEGER NOT NULL,
    `water_ml` INTEGER NOT NULL,
    `alcohol` BOOLEAN NOT NULL,
    `alcohol_units` DECIMAL(3, 1) NULL,
    `notes` TEXT NULL,
    `date` DATE NOT NULL,

    INDEX `daily_habits_user_id_date_idx`(`user_id`, `date` DESC),
    UNIQUE INDEX `daily_habits_user_id_date_key`(`user_id`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `strava_accounts` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `strava_athlete_id` BIGINT NOT NULL,
    `access_token` TEXT NOT NULL,
    `refresh_token` TEXT NOT NULL,
    `token_expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `strava_accounts_user_id_key`(`user_id`),
    UNIQUE INDEX `strava_accounts_strava_athlete_id_key`(`strava_athlete_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `run_activities` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `strava_activity_id` BIGINT NULL,
    `distance_m` INTEGER NOT NULL,
    `moving_time_s` INTEGER NOT NULL,
    `elevation_gain_m` INTEGER NULL,
    `average_pace_s_per_km` INTEGER NOT NULL,
    `start_time` DATETIME(3) NOT NULL,
    `source` ENUM('strava', 'manual') NOT NULL,
    `raw` JSON NULL,

    UNIQUE INDEX `run_activities_strava_activity_id_key`(`strava_activity_id`),
    INDEX `run_activities_user_id_start_time_idx`(`user_id`, `start_time` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_conversations` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `question` TEXT NOT NULL,
    `response` TEXT NOT NULL,
    `context_plan` JSON NOT NULL,
    `context_snapshot` JSON NOT NULL,
    `web_search_results` JSON NULL,
    `context_tokens` INTEGER NOT NULL,
    `total_tokens` INTEGER NOT NULL,
    `duration_ms` INTEGER NOT NULL,
    `domains_fetched` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_conversations_user_id_created_at_idx`(`user_id`, `created_at` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `exercises` ADD CONSTRAINT `exercises_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workouts` ADD CONSTRAINT `workouts_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workout_sets` ADD CONSTRAINT `workout_sets_workout_id_fkey` FOREIGN KEY (`workout_id`) REFERENCES `workouts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workout_sets` ADD CONSTRAINT `workout_sets_exercise_id_fkey` FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workout_templates` ADD CONSTRAINT `workout_templates_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nutrition_logs` ADD CONSTRAINT `nutrition_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `body_metrics` ADD CONSTRAINT `body_metrics_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `daily_habits` ADD CONSTRAINT `daily_habits_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `strava_accounts` ADD CONSTRAINT `strava_accounts_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `run_activities` ADD CONSTRAINT `run_activities_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_conversations` ADD CONSTRAINT `ai_conversations_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
