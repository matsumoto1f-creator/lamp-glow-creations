// Where every box sits on the one-page application (letter size, 612 x 792 points). Kept apart
// from application-pdf.ts so the page that shows the form does not have to load the PDF builder
// (pdf-lib and its fonts, over a megabyte) just to know where the boxes are. No imports.

/** A box on the form in top-left page points: left, top, right, bottom. */
export type Box = readonly [number, number, number, number];

/** Text boxes, positioned from the labels on the template (letter size, 612 x 792). */
export const TEXT_FIELDS: Record<string, Box> = {
  legal_name: [45, 121.5, 305, 132],
  dba: [311, 121.5, 569, 132],
  business_address: [45, 143.5, 243, 154],
  business_city: [247, 143.5, 371, 154],
  business_state: [375, 143.5, 434, 154],
  business_zip: [438, 143.5, 569, 154],
  business_phone: [45, 165.5, 174, 175.5],
  business_email: [178, 165.5, 307, 175.5],
  business_start_date: [311, 165.5, 402, 175.5],
  ein: [406, 165.5, 498, 175.5],
  entity_type: [502, 165.5, 569, 175.5],
  monthly_revenue: [52, 186, 174, 196],
  monthly_card_volume: [185, 186, 307, 196],
  industry: [311, 186.5, 440, 204],
  business_bank: [45, 215.5, 174, 226],
  monthly_deposit_count: [178, 215.5, 307, 226],
  monthly_rent: [397, 215, 440, 224.5],

  owner1_first_name: [45, 254.5, 190, 265],
  owner1_last_name: [194, 254.5, 339, 265],
  owner1_title: [343, 254.5, 434, 265],
  owner1_ownership: [438, 254.5, 498, 265],
  owner1_credit: [502, 254.5, 569, 265],
  owner1_address: [45, 276.5, 243, 287],
  owner1_city: [247, 276.5, 371, 287],
  owner1_state: [375, 276.5, 434, 287],
  owner1_zip: [438, 276.5, 569, 287],
  owner1_mobile: [45, 298.5, 190, 309],
  owner1_email: [194, 298.5, 371, 309],
  owner1_ssn: [375, 298.5, 477, 309],
  owner1_dob: [481, 298.5, 569, 309],

  owner2_first_name: [45, 337.5, 190, 347.5],
  owner2_last_name: [194, 337.5, 339, 347.5],
  owner2_title: [343, 337.5, 434, 347.5],
  owner2_ownership: [438, 337.5, 498, 347.5],
  owner2_credit: [502, 337.5, 569, 347.5],
  owner2_address: [45, 358.5, 243, 369],
  owner2_city: [247, 358.5, 371, 369],
  owner2_state: [375, 358.5, 434, 369],
  owner2_zip: [438, 358.5, 569, 369],
  owner2_mobile: [45, 380.5, 190, 391],
  owner2_email: [194, 380.5, 371, 391],
  owner2_ssn: [375, 380.5, 477, 391],
  owner2_dob: [481, 380.5, 569, 391],

  balance1_funder: [45, 434, 222, 449],
  balance1_original: [226, 434, 317, 449],
  balance1_current: [321, 434, 413, 449],
  balance1_payment: [417, 434, 509, 449],
  balance1_payoff: [513, 434, 569, 449],
  balance2_funder: [45, 455, 222, 470],
  balance2_original: [226, 455, 317, 470],
  balance2_current: [321, 455, 413, 470],
  balance2_payment: [417, 455, 509, 470],
  balance2_payoff: [513, 455, 569, 470],

  amount_requested: [131, 486, 222, 496],
  lamp_rep: [491, 486, 565, 496],
  owner1_print_name: [86, 519, 299, 528],
  owner1_signature: [74, 535, 224, 544],
  owner2_signature: [347, 535, 497, 544],
  owner1_sign_date: [247, 535, 299, 544],
  owner2_print_name: [360, 519, 572, 528],
  owner2_sign_date: [520, 535, 572, 544],
};

/** Checkboxes, placed over the empty squares printed on the template. */
export const CHECKBOXES: Record<string, Box> = {
  use_working_capital: [443.9, 188.6, 449.1, 193.8],
  use_inventory: [500.6, 188.6, 505.8, 193.8],
  use_equipment: [443.9, 196.4, 449.1, 201.6],
  use_payroll: [486.6, 196.4, 491.8, 201.6],
  use_other: [518, 196.4, 523.2, 201.6],
  premises_own: [310.9, 217.4, 316.1, 222.6],
  premises_rent: [336.1, 217.4, 341.3, 222.6],
  liens_no: [443.9, 217.4, 449.1, 222.6],
  liens_yes: [464.2, 217.4, 469.4, 222.6],
  term_3: [313.4, 488.7, 318.6, 493.9],
  term_6: [339.8, 488.7, 345, 493.9],
  term_9: [366.3, 488.7, 371.5, 493.9],
  term_12: [392.8, 488.7, 398, 493.9],
};
