-- CreateTable
CREATE TABLE `health_summaries` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `window` VARCHAR(191) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `sleep_avg_minutes` DOUBLE NOT NULL DEFAULT 0,
    `sleep_avg_deep` DOUBLE NOT NULL DEFAULT 0,
    `sleep_avg_rem` DOUBLE NOT NULL DEFAULT 0,
    `sleep_data_count` INTEGER NOT NULL DEFAULT 0,
    `sleep_trend` VARCHAR(191) NOT NULL DEFAULT 'STABLE',
    `sleep_recent_values` JSON NOT NULL,
    `workout_count` INTEGER NOT NULL DEFAULT 0,
    `workout_avg_duration` DOUBLE NOT NULL DEFAULT 0,
    `workout_avg_calories` DOUBLE NOT NULL DEFAULT 0,
    `rest_day_streak` INTEGER NOT NULL DEFAULT 0,
    `training_day_streak` INTEGER NOT NULL DEFAULT 0,
    `workout_types` JSON NOT NULL,

    UNIQUE INDEX `health_summaries_user_id_window_key`(`user_id`, `window`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `health_summaries` ADD CONSTRAINT `health_summaries_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
