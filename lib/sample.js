// A ready-made result for visitors who don't have the password (e.g. people coming from the portfolio).
// It's the summary of sample-transcript.txt, so no AI call or API key is used.

export const SAMPLE_TRANSCRIPT = `Kartik: Okay, let's start. Main thing today is whether we launch the free plan in December or wait until January.
Meera: I'd push for December. Students are on break, so sign-ups should be higher, and we beat the other two apps to it.
Arjun: My worry is the onboarding. Right now about 40 percent of people drop off before they finish setup. If we launch with that, we waste the spike.
Kartik: Fair. What would it take to fix onboarding?
Arjun: Cutting it from five screens to two. Maybe ten days of work.
Meera: Then we could still do mid-December if Arjun starts Monday.
Kartik: Okay, let's decide: we launch the free plan on December 15, conditional on the new onboarding being done by December 8. If it isn't, we move to January 5.
Meera: Agreed.
Arjun: Agreed. I'll own the onboarding rewrite.
Kartik: Meera, can you draft the launch post and the email to the waitlist by December 10?
Meera: Yes. Do we know how many people are on the waitlist?
Kartik: Not sure, somewhere around 800? I'll check.
Arjun: One more risk: if the free plan is too generous, nobody upgrades. We haven't decided the limits.
Kartik: Right, let's take that offline. I'll set up a pricing call this week.
Meera: Also, are we doing anything on Instagram for launch or just email?
Kartik: Good question, let's figure that out in the pricing call too.`;

export const SAMPLE_SUMMARY = {
  detected_type: "strategy",
  title: "Free plan launch timing",
  summary:
    "The team debated launching the free plan in December versus January. They agreed to launch on December 15 if the onboarding redesign ships by December 8, and otherwise move to January 5. Free-plan limits and the Instagram launch plan are still open.",
  key_points: [
    "December launch would catch students on break and beat two competing apps",
    "About 40% of new users drop off during the current five-screen onboarding",
    "Cutting onboarding to two screens is estimated at ten days of work",
  ],
  decisions: [
    {
      decision: "Launch the free plan on December 15",
      context: "Only if the new onboarding is done by December 8; otherwise launch moves to January 5",
    },
  ],
  action_items: [
    { task: "Rewrite onboarding from five screens to two", owner: "Arjun", due: "Dec 8", priority: "high" },
    { task: "Draft the launch post and the waitlist email", owner: "Meera", due: "Dec 10", priority: "medium" },
    { task: "Confirm the exact waitlist size", owner: "Kartik", due: "No date", priority: "low" },
    { task: "Set up a pricing call to decide free-plan limits", owner: "Kartik", due: "This week", priority: "high" },
  ],
  follow_up_questions: [
    "How generous should the free plan be without hurting upgrades?",
    "Is the launch email-only, or is there an Instagram push too?",
    "Is the waitlist really around 800 people?",
  ],
  options_considered: [
    {
      option: "Launch in December",
      pros: ["Students are on break, so more sign-ups", "Beat the other two apps to market"],
      cons: ["Current onboarding would waste the sign-up spike"],
    },
    {
      option: "Wait until January",
      pros: ["Time to fix onboarding properly"],
      cons: ["Miss the holiday break and give competitors a head start"],
    },
  ],
  risks: ["A too-generous free plan could stop people from upgrading", "Onboarding fix could slip past December 8"],
  standup_updates: [],
  blockers: [],
  insights: [],
  pain_points: [],
  opportunities: [],
  user_quotes: [],
};
