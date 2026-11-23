// Sample data for the browser preview (`npm run dev`, then open /?demo).
import { addDays, todayKey } from "./dates";
import { useStore } from "../store";

export async function seedDemo(): Promise<void> {
  const s = useStore.getState();
  if (s.lists.length || s.tasks.length) return;
  const t = todayKey();
  const studies = await s.addList("Studies");
  const research = await s.addList("Research", studies.id);
  const seminars = await s.addList("Seminars", studies.id);
  const volume = await s.addList("Edited volume");
  const home = await s.addList("Home");
  const general = await s.addSection(research.id, "General");
  const cfp = await s.addSection(research.id, "CFP");
  const papers = await s.addSection(research.id, "Papers");
  const add = s.addTask;

  await add({ title: "Read Esposito on algorithmic prediction", list_id: research.id, section_id: general.id, priority: 2, start_date: addDays(t, 2), end_date: addDays(t, 4) });
  const group = await add({ title: "Reading group: prepare session", list_id: research.id, section_id: general.id, priority: 2, start_date: addDays(t, 1), start_time: "18:00" });
  await add({ title: "Reply to organisers", parent_id: group.id, list_id: research.id });
  await add({ title: "Print the text", parent_id: group.id, list_id: research.id });
  await add({ title: "Conference abstract", list_id: research.id, section_id: cfp.id, priority: 3, start_date: addDays(t, 3), end_date: addDays(t, 6), deadline_date: addDays(t, 9), notes: "500 words, plus short bio." });
  await add({ title: "Workshop application", list_id: research.id, section_id: cfp.id, deadline_date: addDays(t, 16) });
  await add({ title: "Revise article draft", list_id: research.id, section_id: papers.id, priority: 1, start_date: addDays(t, 7), end_date: addDays(t, 13), deadline_date: addDays(t, 20) });
  await add({ title: "Seminar presentation", list_id: seminars.id, priority: 3, start_date: addDays(t, 5), end_date: addDays(t, 8), deadline_date: addDays(t, 8), deadline_time: "10:00" });
  await add({ title: "Sign up for colloquium", list_id: seminars.id, priority: 2, start_date: addDays(t, -3) });
  await add({ title: "Chase missing chapters", list_id: volume.id, priority: 3, start_date: t, deadline_date: addDays(t, 4) });
  await add({ title: "Send style sheet to contributors", list_id: volume.id, start_date: addDays(t, 1) });
  await add({ title: "Call with publisher", list_id: volume.id, priority: 2, start_date: addDays(t, 2), start_time: "11:00", end_time: "12:00" });
  await add({ title: "Proof introduction", list_id: volume.id, start_date: addDays(t, 10), end_date: addDays(t, 12), deadline_date: addDays(t, 14) });
  await add({ title: "Water the plants", list_id: home.id, start_date: t, repeat: "FREQ=DAILY;INTERVAL=3" });
  await add({ title: "Book train tickets", list_id: home.id, priority: 1, deadline_date: addDays(t, 2) });
  await add({ title: "Renew library card", list_id: home.id });
  await add({ title: "Look into bike repair", priority: 1 });
  await add({ title: "Idea: notes on timeline view" });
  const done = await add({ title: "Set up Vitro Tasks", list_id: home.id, start_date: addDays(t, -1) });
  await s.toggleTask(done.id);
}
