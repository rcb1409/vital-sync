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

    type DashboardSummary {
    todayWorkouts: Int!
    macros: MacroTotals!
    streaks: Streaks!
    currentWeightEma: Float
  }
 type Query {
    getDashboardSummary: DashboardSummary!
  }
`;