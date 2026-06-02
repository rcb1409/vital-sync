export const typeDefs = `#graphql
  type MacroTotals {
    calories: Int!
    proteinG: Float!
    carbsG: Float!
    fatG: Float!
    waterMl: Int!
  }

  type Streaks {
    hydration: Int!
    alcoholFree: Int!
  }

  # ---- Chart Data Types ----

  type WeightDataPoint {
    date: String!
    rawWeight: Float!
    emaWeight: Float!
  }

  type CalorieDataPoint {
    date: String!
    calories: Int!
    target: Int!
  }

  type MacroBreakdown {
    protein: Float!
    carbs: Float!
    fat: Float!
  }

  type VolumeDataPoint {
    muscleGroup: String!
    volume: Float!
  }

  type DashboardCharts {
    weightTrend: [WeightDataPoint!]!
    dailyCalories: [CalorieDataPoint!]!
    macroBreakdown: MacroBreakdown!
    weeklyVolume: [VolumeDataPoint!]!
  }

  type DashboardSummary {
    todayWorkouts: Int!
    macros: MacroTotals!
    streaks: Streaks!
    currentWeightEma: Float
    charts: DashboardCharts!
  }

  type Query {
    getDashboardSummary(rangeDays: Int): DashboardSummary!
  }
`;