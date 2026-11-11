export const MALE_NAMES = [
  "Abdul",
  "Arif",
  "Imran",
  "Tanvir",
  "Rakib",
  "Shakib",
  "Mahmud",
  "Fahim",
  "Nasir",
  "Rafiq",
  "Kamal",
  "Jahid",
  "Sabbir",
  "Mehedi",
  "Tareq",
  "Anis",
  "Farhan",
  "Sajid",
  "Zahid",
  "Mizan",
  "Rashed",
  "Sohel",
  "Shafiq",
  "Asif",
  "Nayeem",
  "Touhid",
  "Riaz",
  "Monir",
  "Ashraf",
  "Habib",
];

export const FEMALE_NAMES = [
  "Ayesha",
  "Fatema",
  "Nusrat",
  "Sumaiya",
  "Tasnim",
  "Farzana",
  "Sharmin",
  "Rumana",
  "Sadia",
  "Jannat",
  "Maliha",
  "Nabila",
  "Shirin",
  "Rokeya",
  "Salma",
  "Taslima",
  "Mahfuza",
  "Lamia",
  "Afsana",
  "Sabrina",
  "Tahmina",
  "Nasrin",
  "Rehana",
  "Marzia",
  "Ishrat",
  "Samira",
  "Fahmida",
  "Dilruba",
  "Kaniz",
  "Zakia",
];

export const FAMILY_NAMES = [
  "Rahman",
  "Hossain",
  "Islam",
  "Ahmed",
  "Chowdhury",
  "Khan",
  "Uddin",
  "Karim",
  "Sarker",
  "Mia",
  "Haque",
  "Alam",
  "Siddique",
  "Talukdar",
  "Kabir",
  "Mollah",
  "Sheikh",
  "Biswas",
  "Das",
  "Roy",
  "Saha",
  "Barua",
  "Ali",
  "Hasan",
  "Bhuiyan",
  "Majumder",
  "Sikder",
  "Howlader",
  "Paul",
  "Azad",
];

interface Hospital {
  name: string;
  /** Relative share of doctors. */
  size: number;
  /** Specializations it is known for, which draw three times as many of its doctors. */
  focus?: string[];
}

export const HOSPITALS: Hospital[] = [
  { name: "Dhaka Medical College Hospital", size: 1.5 },
  { name: "Bangladesh Medical University Hospital", size: 1.4 },
  { name: "Square Hospital", size: 1.2 },
  { name: "Evercare Hospital Dhaka", size: 1.1 },
  { name: "United Hospital", size: 1 },
  { name: "BIRDEM General Hospital", size: 1, focus: ["Endocrinology", "Ophthalmology"] },
  { name: "Labaid Specialized Hospital", size: 0.9, focus: ["Cardiology"] },
  { name: "Ibn Sina Hospital", size: 0.8 },
  { name: "Popular Medical College Hospital", size: 0.7 },
  { name: "Kurmitola General Hospital", size: 0.7 },
  { name: "Green Life Hospital", size: 0.6 },
  { name: "Asgar Ali Hospital", size: 0.6 },
];

interface Specialization {
  name: string;
  /** Relative share of doctors. */
  weight: number;
  diagnoses: string[];
  ageRange: [number, number];
  femaleOnly?: boolean;
}

export const SPECIALIZATIONS: Specialization[] = [
  {
    name: "General Medicine",
    weight: 5,
    diagnoses: [
      "Dengue fever",
      "Typhoid fever",
      "Acute watery diarrhoea",
      "Viral fever",
      "Iron deficiency anemia",
    ],
    ageRange: [16, 88],
  },
  {
    name: "Cardiology",
    weight: 4,
    diagnoses: ["Hypertension", "Coronary artery disease", "Atrial fibrillation", "Heart failure"],
    ageRange: [35, 90],
  },
  {
    name: "Pediatrics",
    weight: 4,
    diagnoses: ["Bronchiolitis", "Acute gastroenteritis", "Childhood asthma", "Dengue fever"],
    ageRange: [0, 15],
  },
  {
    name: "Gynecology & Obstetrics",
    weight: 3,
    diagnoses: ["Antenatal care", "Endometriosis", "Uterine fibroids", "Gestational diabetes"],
    ageRange: [18, 55],
    femaleOnly: true,
  },
  {
    name: "Orthopedics",
    weight: 3,
    diagnoses: [
      "Knee osteoarthritis",
      "Lumbar disc herniation",
      "Femur fracture",
      "Rotator cuff tear",
    ],
    ageRange: [14, 85],
  },
  {
    name: "Endocrinology",
    weight: 3,
    diagnoses: [
      "Type 2 diabetes",
      "Hypothyroidism",
      "Type 1 diabetes",
      "Polycystic ovary syndrome",
    ],
    ageRange: [18, 82],
  },
  {
    name: "Gastroenterology",
    weight: 2,
    diagnoses: ["Peptic ulcer disease", "Irritable bowel syndrome", "Hepatitis B", "Gallstones"],
    ageRange: [18, 80],
  },
  {
    name: "Neurology",
    weight: 2,
    diagnoses: ["Migraine", "Epilepsy", "Ischemic stroke", "Parkinson's disease"],
    ageRange: [18, 88],
  },
  {
    name: "Pulmonology",
    weight: 2,
    diagnoses: ["Asthma", "COPD", "Pneumonia", "Tuberculosis"],
    ageRange: [18, 86],
  },
  {
    name: "Nephrology",
    weight: 2,
    diagnoses: [
      "Chronic kidney disease",
      "Kidney stones",
      "Urinary tract infection",
      "Nephrotic syndrome",
    ],
    ageRange: [20, 85],
  },
  {
    name: "Dermatology",
    weight: 2,
    diagnoses: ["Atopic dermatitis", "Psoriasis", "Acne vulgaris", "Fungal skin infection"],
    ageRange: [10, 75],
  },
  {
    name: "Oncology",
    weight: 1,
    diagnoses: ["Breast cancer", "Lung cancer", "Colorectal cancer", "Lymphoma"],
    ageRange: [28, 85],
  },
  {
    name: "Psychiatry",
    weight: 1,
    diagnoses: [
      "Major depressive disorder",
      "Generalized anxiety disorder",
      "Bipolar disorder",
      "Insomnia",
    ],
    ageRange: [16, 75],
  },
  {
    name: "Ophthalmology",
    weight: 1,
    diagnoses: ["Cataract", "Glaucoma", "Diabetic retinopathy", "Conjunctivitis"],
    ageRange: [8, 88],
  },
  {
    name: "ENT",
    weight: 1,
    diagnoses: ["Chronic sinusitis", "Tonsillitis", "Otitis media", "Hearing loss"],
    ageRange: [5, 80],
  },
];

/** Relative intake by Dhaka calendar month, January first, with an optional factor per year. */
interface Season {
  months: number[];
  years?: Record<number, number>;
}

// Dengue rises with the monsoon and peaks from August to October; 2026's season runs heavier.
const DENGUE: Season = {
  months: [0.15, 0.1, 0.1, 0.15, 0.3, 0.7, 1.8, 3.2, 4.2, 4.6, 3.4, 1],
  years: { 2026: 1.45 },
};
// Diarrhoeal disease peaks before the monsoon (April to May) and again late in it.
const DIARRHOEAL: Season = {
  months: [0.5, 0.6, 1, 1.7, 2, 1.7, 1.5, 1.6, 1.5, 1.1, 0.7, 0.5],
  years: { 2026: 1.1 },
};
const TYPHOID: Season = { months: [0.6, 0.6, 0.9, 1.3, 1.6, 1.7, 1.6, 1.5, 1.3, 1, 0.8, 0.6] };
// Pneumonia, bronchiolitis and asthma attacks climb in the dry, cold, smoggy winter.
const WINTER_RESPIRATORY: Season = {
  months: [2.4, 1.9, 1.2, 0.8, 0.6, 0.6, 0.7, 0.7, 0.7, 0.9, 1.4, 2.2],
  years: { 2026: 0.9 },
};
const COPD: Season = { months: [2, 1.7, 1.2, 0.9, 0.7, 0.7, 0.7, 0.7, 0.8, 0.9, 1.3, 1.9] };
const MONSOON: Season = { months: [0.6, 0.6, 0.7, 0.8, 0.9, 1.2, 1.6, 1.9, 1.6, 1, 0.7, 0.6] };

export const SEASONS: Record<string, Season> = {
  "Dengue fever": DENGUE,
  "Acute watery diarrhoea": DIARRHOEAL,
  "Acute gastroenteritis": DIARRHOEAL,
  "Typhoid fever": TYPHOID,
  Pneumonia: WINTER_RESPIRATORY,
  Bronchiolitis: WINTER_RESPIRATORY,
  Asthma: WINTER_RESPIRATORY,
  "Childhood asthma": WINTER_RESPIRATORY,
  COPD,
  Conjunctivitis: MONSOON,
  "Fungal skin infection": MONSOON,
};

type Severity = "high" | "low";

/** Diagnoses that run more or less severe than the rest; unlisted ones use the base weights. */
export const SEVERITY: Record<string, Severity> = Object.fromEntries([
  ...[
    "Dengue fever",
    "Heart failure",
    "Coronary artery disease",
    "Ischemic stroke",
    "Breast cancer",
    "Lung cancer",
    "Colorectal cancer",
    "Lymphoma",
    "Pneumonia",
    "COPD",
    "Tuberculosis",
    "Chronic kidney disease",
    "Nephrotic syndrome",
    "Femur fracture",
    "Bronchiolitis",
  ].map((name) => [name, "high"]),
  ...[
    "Acne vulgaris",
    "Atopic dermatitis",
    "Psoriasis",
    "Fungal skin infection",
    "Conjunctivitis",
    "Cataract",
    "Hearing loss",
    "Tonsillitis",
    "Otitis media",
    "Chronic sinusitis",
    "Migraine",
    "Insomnia",
    "Irritable bowel syndrome",
    "Antenatal care",
    "Hypothyroidism",
    "Iron deficiency anemia",
    "Viral fever",
    "Knee osteoarthritis",
  ].map((name) => [name, "low"]),
]);
