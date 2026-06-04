/**
 * Shapes returned by the backend REST API (`/api/v1`).
 *
 * The wire format is `snake_case` and every value type mirrors a spatie
 * `Data` object on the server. Responses are wrapped in `{ "data": ... }`;
 * `apiRequest` unwraps that envelope, so these types describe the *inner* value.
 */

export type HouseholdRole = 'owner' | 'member';
export type MealType = 'breakfast' | 'lunch' | 'dinner';
export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'expired';

export type Household = {
  id: number;
  name: string;
  default_servings: number;
};

/** A household from `/households`, carrying the caller's role in it. */
export type HouseholdMembership = {
  id: number;
  name: string;
  role: HouseholdRole;
};

export type Member = {
  id: number;
  name: string;
  email: string;
  role: HouseholdRole;
};

export type Invitation = {
  id: number;
  email: string;
  role: HouseholdRole;
  status: InvitationStatus;
  expires_at: string | null;
};

export type DinnerPlanEntry = {
  id: number;
  dinner_id: number;
  dinner_name: string | null;
  scheduled_date: string;
  servings: number;
  meal_type: MealType;
  notes: string | null;
};

export type DinnerPlan = {
  id: number;
  name: string;
  start_date: string | null;
  end_date: string | null;
  entries: DinnerPlanEntry[];
};

export type Ingredient = {
  id: number;
  name: string;
  default_unit: string | null;
  category: string | null;
};

export type DinnerItem = {
  id: number;
  ingredient_id: number;
  ingredient_name: string | null;
  quantity: string | null;
  unit: string | null;
};

export type Dinner = {
  id: number;
  name: string;
  default_servings: number;
  notes: string | null;
  items: DinnerItem[];
};

export type User = {
  id: number;
  name: string;
  email: string;
  email_verified: boolean;
  two_factor_enabled: boolean;
  theme: 'system' | 'light' | 'dark';
  locale: 'en' | 'nb';
  current_household: Household | null;
};

/** One active access token == one signed-in device. */
export type Device = {
  id: string;
  name: string | null;
  last_used_at: string | null;
  created_at: string;
  current: boolean;
};
