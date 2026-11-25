import { handleSchedule } from "@vercel/schedules";
import { deleteExpiredDemos, demoEnabled } from "@/lib/demo";

// Private Vercel schedule (see vercel.json): no public URL, only the scheduler
// can call it. Runs daily, which also keeps a free Supabase project from
// pausing for inactivity.
export const POST = handleSchedule(async (metadata) => {
  if (!demoEnabled()) return;
  const deleted = await deleteExpiredDemos();
  console.log(`[demo-cleanup] ${metadata.executionId}: removed ${deleted.orgs} orgs, ${deleted.users} users`);
});
