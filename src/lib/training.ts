/**
 * The Lamp tutorial series (2026-11): short narrated walkthroughs of the real screens, recorded on
 * training data. Each video lives in public/training as <slug>.mp4 (720p), <slug>.jpg (poster) and
 * <slug>.vtt (captions). Reps see the rep series, admins see rep and admin, merchants see theirs on
 * their account page; staff also see the merchant series, to send or point merchants to.
 */
export type TrainingRole = "rep" | "admin" | "merchant";

export type TrainingVideo = {
  slug: string;
  role: TrainingRole;
  part: number;
  title: string;
  /** One line on what it covers. */
  about: string;
  /** Length in seconds. */
  sec: number;
};

export const TRAINING: readonly TrainingVideo[] = [
  {
    slug: "rep-1-your-screen",
    role: "rep",
    part: 1,
    title: "Your screen",
    about: "Where everything is, and what it's for.",
    sec: 123,
  },
  {
    slug: "rep-2-engine-leads",
    role: "rep",
    part: 2,
    title: "Engine leads",
    about: "Where your calls come from, how to work them, and how to get their email.",
    sec: 170,
  },
  {
    slug: "rep-3-files-and-stages",
    role: "rep",
    part: 3,
    title: "Files and stages",
    about: "Every merchant who applies becomes a file. Files move one stage at a time.",
    sec: 99,
  },
  {
    slug: "rep-4-working-a-file",
    role: "rep",
    part: 4,
    title: "Working a file",
    about: "Notes, documents, the contact card and the timeline.",
    sec: 134,
  },
  {
    slug: "rep-5-funders-and-offers",
    role: "rep",
    part: 5,
    title: "Funders and offers",
    about: "Sending a file to funders, and recording their offers.",
    sec: 119,
  },
  {
    slug: "rep-6-your-numbers",
    role: "rep",
    part: 6,
    title: "Your numbers",
    about: "Your dashboard and your money.",
    sec: 84,
  },
  {
    slug: "admin-1-team",
    role: "admin",
    part: 1,
    title: "Team",
    about: "Adding reps, teams and invites.",
    sec: 65,
  },
  {
    slug: "admin-2-running-the-board",
    role: "admin",
    part: 2,
    title: "Running the board",
    about: "Every file, from every rep.",
    sec: 67,
  },
  {
    slug: "admin-3-funders",
    role: "admin",
    part: 3,
    title: "Funders",
    about: "Keeping the funder list up to date.",
    sec: 81,
  },
  {
    slug: "admin-4-dashboard-and-money",
    role: "admin",
    part: 4,
    title: "Dashboard and Money",
    about: "Everyone's numbers, and what's owed.",
    sec: 93,
  },
  {
    slug: "merchant-1-applying",
    role: "merchant",
    part: 1,
    title: "Applying",
    about: "Your link, your application, and signing it.",
    sec: 56,
  },
  {
    slug: "merchant-2-your-account",
    role: "merchant",
    part: 2,
    title: "Your account",
    about: "Where your file stands, and what's still needed.",
    sec: 60,
  },
  {
    slug: "merchant-3-your-offers",
    role: "merchant",
    part: 3,
    title: "Your offers",
    about: "Offers from funders, side by side.",
    sec: 57,
  },
];

export const trainingFor = (role: TrainingRole) => TRAINING.filter((v) => v.role === role);

export const trainingSrc = (slug: string, ext: "mp4" | "jpg" | "vtt") => `/training/${slug}.${ext}`;

export const clock = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
