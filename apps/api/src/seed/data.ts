import type { DailyTargets, IngredientClass, Product, Recipe, User } from '@macrofill/domain';

// Seed data (M4-5). Curated content is global; users and their targets come from here too.
// IDs are fixed so running the seed again updates rows instead of adding new ones.
// Label values: test_data/nutritional_example.json, which has no fibre (unknown, never 0).
// Adding a product means adding it here.

const ingredientClasses: IngredientClass[] = [
  { id: 'wholegrain-bread', name: { en: 'Wholegrain bread' } },
  { id: 'cream-cheese', name: { en: 'Cream cheese' } },
  { id: 'cheese', name: { en: 'Cheese' } },
  { id: 'ham', name: { en: 'Ham' } },
  { id: 'curd', name: { en: 'Curd' } },
  { id: 'milk', name: { en: 'Milk' } },
  { id: 'cucumber', name: { en: 'Cucumber' } },
  { id: 'radish', name: { en: 'Radish' } },
];

const product = (
  id: string,
  ingredientClassId: string,
  name: string,
  nutrition: Product['nutrition'],
): Product => ({ id, ingredientClassId, name, nutrition, source: 'seed' });

const p = {
  bread: product(
    '1de22574-2eab-46f7-bd0f-4910acdb36c2',
    'wholegrain-bread',
    'VINCENT Chleb pełnoziarnisty',
    {
      kcal: 229,
      fat: 5.0,
      saturates: null,
      carbs: 37.0,
      sugars: null,
      protein: 7.0,
      salt: null,
      fibre: null,
    },
  ),
  creamCheese: product(
    '4849a2d0-4f00-4fea-9c87-0b044d0165a5',
    'cream-cheese',
    'ALMETTE Serek twarogowy z ogórkiem i ziołami',
    {
      kcal: 251,
      fat: 23.0,
      saturates: 16.0,
      carbs: 4.1,
      sugars: 3.0,
      protein: 7.0,
      salt: 0.86,
      fibre: null,
    },
  ),
  cheese: product(
    '11cf7955-786f-4df9-bf39-b5437917683f',
    'cheese',
    'Mlekpol Ser Królewski z Kolna',
    {
      kcal: 347,
      fat: 27.0,
      saturates: 17.0,
      carbs: 0.0,
      sugars: 0.0,
      protein: 26.0,
      salt: 1.3,
      fibre: null,
    },
  ),
  ham: product('e8862ff4-2d5a-46d9-9855-4154f60d62da', 'ham', 'Sokołów Szynka z piersi indyka', {
    kcal: 87,
    fat: 2.0,
    saturates: 0.8,
    carbs: 1.2,
    sugars: 0.5,
    protein: 16.0,
    salt: 2.0,
    fibre: null,
  }),
  curd: product('033ee3fe-72a7-409c-8dc3-76626baa14db', 'curd', 'Polmlek Twaróg półtłusty', {
    kcal: 119,
    fat: 4.2,
    saturates: 2.8,
    carbs: 3.4,
    sugars: 3.0,
    protein: 17.0,
    salt: 0.1,
    fibre: null,
  }),
  milk: product('2fb48689-9acc-4a8a-9b1f-f0bf8e44b474', 'milk', 'Mleko Łowicz UHT 3.2%', {
    kcal: 60,
    fat: 3.2,
    saturates: 1.9,
    carbs: 4.7,
    sugars: 4.7,
    protein: 3.0,
    salt: 0.1,
    fibre: null,
  }),
  skimmedMilk: product(
    '2597fc57-8e69-4c9e-9740-20091002f416',
    'milk',
    'Mleko Łowicz UHT odtłuszczone 0.5%',
    {
      kcal: 37,
      fat: 0.5,
      saturates: 0.3,
      carbs: 5.0,
      sugars: 5.0,
      protein: 3.0,
      salt: 0.1,
      fibre: null,
    },
  ),
  cucumber: product('783cae78-b76f-45a1-b43d-254cfcef6014', 'cucumber', 'Ogórki kiszone', {
    kcal: 11,
    fat: 0.5,
    saturates: 0.1,
    carbs: 1.0,
    sugars: 0.5,
    protein: 0.7,
    salt: 1.9,
    fibre: null,
  }),
  radish: product(
    'd1ebd546-5f53-4233-a4b4-d12a3297d42d',
    'radish',
    'FRISCO FRESH Rzodkiewka pęczek',
    {
      kcal: 21,
      fat: 0.2,
      saturates: null,
      carbs: 4.4,
      sugars: null,
      protein: 1.0,
      salt: null,
      fibre: null,
    },
  ),
};

const recipes: Recipe[] = [
  {
    id: '29c28733-1275-4740-beaa-62b5eea1e4cd',
    name: { en: 'Sandwich' },
    steps: [
      {
        id: '1ccf8871-9af1-4f09-8b1b-556f3e7f0751',
        ingredientClassId: 'wholegrain-bread',
        defaultProductId: p.bread.id,
      },
      {
        id: 'd7d7d583-02bb-415c-9ba2-3cb86cb785f6',
        ingredientClassId: 'cream-cheese',
        defaultProductId: p.creamCheese.id,
      },
      {
        id: '2f2163d1-7ee0-4370-aca6-203fb9ceb6ed',
        ingredientClassId: 'cheese',
        defaultProductId: p.cheese.id,
      },
      {
        id: '4cc07964-8d7e-4e86-b5a1-4ceb71a6dfb1',
        ingredientClassId: 'ham',
        defaultProductId: p.ham.id,
      },
    ],
  },
  {
    id: '9a13c2a4-8d6e-401e-aeb3-deb367561938',
    name: { en: 'Curd' },
    steps: [
      {
        id: 'a6b75d73-d68a-4eec-8219-5a16aeb9917e',
        ingredientClassId: 'curd',
        defaultProductId: p.curd.id,
      },
      {
        id: 'b48924bb-4fa3-4843-b727-6928f03636d0',
        ingredientClassId: 'milk',
        defaultProductId: p.milk.id,
      },
      {
        id: '093be00d-6f5c-4559-8b47-2c5d66b50aca',
        ingredientClassId: 'cucumber',
        defaultProductId: p.cucumber.id,
      },
      {
        id: '0801a3fc-1914-47fd-a5d7-810400588db1',
        ingredientClassId: 'ham',
        defaultProductId: p.ham.id,
      },
      {
        id: 'dc2aa1c6-3c1b-4976-9614-f703956d6217',
        ingredientClassId: 'radish',
        defaultProductId: p.radish.id,
      },
    ],
  },
];

export interface SeedUser {
  user: User;
  /** `null` means not tracked. Set your own numbers here. */
  targets: DailyTargets;
}

const users: SeedUser[] = [
  {
    user: {
      id: '8911a136-8163-4ff5-b2f9-07d495488cfd',
      username: 'mlewand',
      timezone: 'Europe/Warsaw',
    },
    targets: { protein: 160, fat: 65, carbs: null, fibre: null, kcal: 2700 },
  },
];

export const seedData = {
  ingredientClasses,
  products: Object.values(p),
  recipes,
  users,
};
