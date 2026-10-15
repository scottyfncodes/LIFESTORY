/**
 * The interview coverage model. Areas are optional prompts, not mandatory
 * chapters; the planner uses them to find a good next question while the
 * narrator remains free to go anywhere.
 */
export const COVERAGE_AREAS = [
  { id: "childhood", label: "Childhood and early homes", scopes: ["full_life", "childhood", "family"] },
  { id: "family", label: "Family and caregivers", scopes: ["full_life", "childhood", "family", "legacy"] },
  { id: "school", label: "School and friendships", scopes: ["full_life", "childhood"] },
  { id: "young_adult", label: "Adolescence and early adulthood", scopes: ["full_life", "specific_period"] },
  { id: "work", label: "Work and meaningful projects", scopes: ["full_life", "career", "specific_period"] },
  { id: "relationships", label: "Relationships, marriage and parenthood", scopes: ["full_life", "family", "specific_period"] },
  { id: "places", label: "Places lived and important journeys", scopes: ["full_life", "specific_period", "career"] },
  { id: "turning_points", label: "Difficult periods and turning points", scopes: ["full_life", "career", "specific_period", "legacy"] },
  { id: "beliefs", label: "Beliefs, values and lessons learned", scopes: ["full_life", "legacy", "career"] },
  { id: "later_life", label: "Later life, reflection and legacy", scopes: ["full_life", "legacy"] },
] as const;

export type CoverageAreaId = (typeof COVERAGE_AREAS)[number]["id"];
export const COVERAGE_AREA_IDS = COVERAGE_AREAS.map((a) => a.id) as [CoverageAreaId, ...CoverageAreaId[]];

export function coverageLabel(id: string | null | undefined): string | null {
  if (!id) return null;
  return COVERAGE_AREAS.find((a) => a.id === id)?.label ?? null;
}

export function areasForScope(scope: string): CoverageAreaId[] {
  const matching = COVERAGE_AREAS.filter((a) => (a.scopes as readonly string[]).includes(scope));
  return (matching.length > 0 ? matching : COVERAGE_AREAS).map((a) => a.id);
}

export type QuestionTemplate = {
  id: string;
  area: CoverageAreaId;
  text: (name: string) => string;
  /** Words that indicate a topic the narrator asked to avoid. */
  tags: string[];
  /** Templates marked as openers are preferred at the start of an area. */
  opener?: boolean;
};

export const QUESTION_TEMPLATES: QuestionTemplate[] = [
  // childhood
  { id: "childhood.first_home", area: "childhood", opener: true, tags: ["home", "house"], text: () => "Let's start somewhere simple. Where were you born, and what is the first home you can remember?" },
  { id: "childhood.room", area: "childhood", tags: ["home"], text: () => "Can you picture the house or flat you grew up in? What did it look like inside, and where did you spend most of your time?" },
  { id: "childhood.earliest_memory", area: "childhood", tags: [], text: () => "What is one of your earliest memories, even a small one?" },
  { id: "childhood.neighbourhood", area: "childhood", tags: ["neighbourhood", "street"], text: () => "What was the neighbourhood or area like when you were small? Who lived nearby?" },
  { id: "childhood.play", area: "childhood", tags: [], text: () => "What did you do for fun as a child? Were there games, places or routines you loved?" },
  // family
  { id: "family.parents", area: "family", opener: true, tags: ["parents", "mother", "father", "mum", "dad"], text: () => "Tell me about the people who raised you. What were they like, and how would you describe them to someone who never met them?" },
  { id: "family.siblings", area: "family", tags: ["siblings", "brother", "sister"], text: () => "Did you grow up with brothers or sisters, or other children in the house? What was that like?" },
  { id: "family.grandparents", area: "family", tags: ["grandparents", "grandmother", "grandfather"], text: () => "Were grandparents or older relatives part of your childhood? Is there one you think of often?" },
  { id: "family.traditions", area: "family", tags: ["holidays", "religion"], text: () => "Were there family traditions, meals or holidays that mattered when you were growing up?" },
  { id: "family.sayings", area: "family", tags: [], text: () => "Is there something a parent or relative used to say that has stayed with you?" },
  // school
  { id: "school.first_day", area: "school", opener: true, tags: ["school"], text: () => "What do you remember about starting school? Was there a teacher or a friend who made a difference early on?" },
  { id: "school.friends", area: "school", tags: ["friends"], text: () => "Who were your closest friends growing up, and what did you get up to together?" },
  { id: "school.subjects", area: "school", tags: ["school"], text: () => "Was there a subject, teacher or activity at school that you loved, or one you dreaded?" },
  // young adult
  { id: "young.leaving", area: "young_adult", opener: true, tags: [], text: () => "What were you like as a teenager, and what did you imagine your life would become?" },
  { id: "young.first_job", area: "young_adult", tags: ["work", "job"], text: () => "What was your first job or first real responsibility, and what did it teach you?" },
  { id: "young.independence", area: "young_adult", tags: [], text: () => "When did you first live away from home, and how did that feel?" },
  // work
  { id: "work.path", area: "work", opener: true, tags: ["work", "career", "job"], text: () => "How did you come to do the work you did? Was it planned, or did it find you?" },
  { id: "work.proud", area: "work", tags: ["work"], text: () => "Is there a piece of work or a project you are especially proud of? What made it matter?" },
  { id: "work.people", area: "work", tags: ["work", "colleagues"], text: () => "Who did you work alongside that you still think about, and why?" },
  { id: "work.hard", area: "work", tags: ["work"], text: () => "What was the hardest stretch of your working life, and how did you get through it?" },
  // relationships
  { id: "rel.meeting", area: "relationships", opener: true, tags: ["marriage", "partner", "husband", "wife", "dating", "love"], text: () => "Tell me about an important relationship in your life. How did you meet, and what drew you to each other?" },
  { id: "rel.children", area: "relationships", tags: ["children", "kids", "parenthood"], text: () => "If you have children or have helped raise any, what do you remember about those early years?" },
  { id: "rel.friendship", area: "relationships", tags: ["friends"], text: () => "Who has been a steady friend through your life? What has that friendship looked like?" },
  // places
  { id: "places.moves", area: "places", opener: true, tags: ["move", "moving"], text: () => "What places have you lived in over the years? Which one felt most like home, and why?" },
  { id: "places.journey", area: "places", tags: ["travel"], text: () => "Is there a journey or a trip that changed how you saw things?" },
  { id: "places.landscape", area: "places", tags: [], text: () => "Is there a particular landscape, street or room that you could describe with your eyes closed?" },
  // turning points
  { id: "turning.decision", area: "turning_points", opener: true, tags: [], text: () => "Looking back, was there a decision or a moment that set your life on a different course?" },
  { id: "turning.difficult", area: "turning_points", tags: ["illness", "loss", "death", "divorce"], text: () => "Everyone has seasons that are hard. If you are comfortable, tell me about a time you had to find your footing again. We can skip this if you'd rather." },
  { id: "turning.luck", area: "turning_points", tags: [], text: () => "Was there a stroke of luck, or an unexpected kindness, that made a real difference?" },
  // beliefs
  { id: "beliefs.values", area: "beliefs", opener: true, tags: ["religion", "faith", "politics"], text: () => "What do you believe in, and where do you think those beliefs came from?" },
  { id: "beliefs.lesson", area: "beliefs", tags: [], text: () => "If you could pass on one lesson you learned the hard way, what would it be?" },
  { id: "beliefs.changed", area: "beliefs", tags: [], text: () => "Is there something you used to think that you have changed your mind about over the years?" },
  // later life
  { id: "later.now", area: "later_life", opener: true, tags: [], text: () => "What does an ordinary good day look like for you now?" },
  { id: "later.proud", area: "later_life", tags: [], text: () => "When you look back over everything, what are you most glad you did?" },
  { id: "later.hope", area: "later_life", tags: [], text: (name) => `What do you hope the people reading this book will understand about you, ${name}?` },
];

export const OPENING_QUESTIONS: Record<string, (name: string) => string> = {
  full_life: (name) => `Welcome, ${name}. There's no hurry and no wrong answer here. To begin, where were you born, and what is the first home you can remember?`,
  childhood: (name) => `Welcome, ${name}. Let's begin with the early years. Where did you grow up, and what is the first home you can picture clearly?`,
  family: (name) => `Welcome, ${name}. Let's start with the people. Who was in your family when you were growing up, and who were you closest to?`,
  career: (name) => `Welcome, ${name}. Let's start with the work. What was the first job you ever had, and how did it lead to what came later?`,
  specific_period: (name) => `Welcome, ${name}. Let's begin where this part of your story starts. Where were you living at the time, and what was life like day to day?`,
  legacy: (name) => `Welcome, ${name}. Let's begin with the big picture. When you think about the life you've lived so far, what comes to mind first?`,
};

export const OPENING_TEMPLATE_IDS: Record<string, string> = {
  full_life: "childhood.first_home",
  childhood: "childhood.first_home",
  family: "family.parents",
  career: "young.first_job",
  specific_period: "places.moves",
  legacy: "later.proud",
};
