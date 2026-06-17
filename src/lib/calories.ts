// Calorie equivalents for common stored / homegrown foods.
// Values are approximate kcal per pound (USDA-ish rounded).
const TABLE: Record<string, number> = {
  // grains & starches
  wheat: 1500, "hard wheat": 1500, "soft wheat": 1500, "white wheat": 1500,
  flour: 1640, "white flour": 1640, "whole wheat flour": 1500,
  rice: 1640, "white rice": 1650, "brown rice": 1640,
  oats: 1750, "rolled oats": 1750, oatmeal: 1750,
  cornmeal: 1640, corn: 1640, popcorn: 1730,
  pasta: 1660, noodles: 1660, barley: 1560, quinoa: 1660, rye: 1500,
  // legumes
  beans: 1500, "black beans": 1500, "pinto beans": 1500, "kidney beans": 1500,
  "navy beans": 1500, "white beans": 1500, lentils: 1500, peas: 1500,
  "split peas": 1500, chickpeas: 1640, garbanzo: 1640, soybeans: 1880,
  // fats & sweeteners
  oil: 4000, "olive oil": 4000, "vegetable oil": 4000, "coconut oil": 4000,
  butter: 3250, ghee: 4000, lard: 4080, shortening: 4080,
  sugar: 1750, "white sugar": 1750, "brown sugar": 1700, honey: 1380,
  syrup: 1200, "maple syrup": 1180, molasses: 1230,
  // dairy
  "powdered milk": 2050, "dry milk": 2050, "nonfat dry milk": 1640,
  milk: 290, "whole milk": 290, cheese: 1800, yogurt: 270, butter_fat: 3250,
  // nuts & seeds
  peanut: 2580, peanuts: 2580, "peanut butter": 2680, almonds: 2620,
  walnuts: 2960, "sunflower seeds": 2570, "chia seeds": 2160,
  // meat & protein
  beef: 1180, "ground beef": 1180, chicken: 750, "chicken breast": 740,
  pork: 1180, fish: 500, salmon: 940, tuna: 590, eggs: 650, egg: 650,
  bacon: 2380,
  // vegetables
  potato: 350, potatoes: 350, "sweet potato": 390,
  tomato: 80, tomatoes: 80, carrot: 185, carrots: 185,
  onion: 180, onions: 180, garlic: 670,
  lettuce: 70, cabbage: 110, broccoli: 155, cauliflower: 110,
  spinach: 105, kale: 220, "green beans": 140, peppers: 90,
  cucumber: 70, squash: 140, pumpkin: 120, zucchini: 75,
  // fruit
  apple: 235, apples: 235, pear: 260, pears: 260,
  banana: 405, bananas: 405, orange: 215, oranges: 215,
  berries: 195, strawberries: 145, blueberries: 260, raspberries: 235,
  grapes: 310, peach: 175, peaches: 175, plum: 210, plums: 210,
  // pantry
  salt: 0, "baking soda": 0, "baking powder": 240, vinegar: 95,
  cocoa: 1010, coffee: 0, tea: 0, "dried fruit": 1500, raisins: 1370,
};

export const DEFAULT_KCAL_PER_LB = 1600;

export function kcalPerLb(name?: string | null): number {
  if (!name) return DEFAULT_KCAL_PER_LB;
  const n = name.toLowerCase().trim();
  if (TABLE[n] != null) return TABLE[n];
  // longest-match substring lookup
  let best: { k: string; v: number } | null = null;
  for (const k of Object.keys(TABLE)) {
    if (n.includes(k) && (!best || k.length > best.k.length)) {
      best = { k, v: TABLE[k] };
    }
  }
  return best ? best.v : DEFAULT_KCAL_PER_LB;
}

export function kcalFromLbs(name: string | null | undefined, lbs: number): number {
  return (Number(lbs) || 0) * kcalPerLb(name);
}

export function fmtKcal(n: number): string {
  if (!isFinite(n) || n <= 0) return "0 kcal";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M kcal`;
  if (n >= 10_000) return `${(n / 1000).toFixed(0)}k kcal`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k kcal`;
  return `${Math.round(n)} kcal`;
}
