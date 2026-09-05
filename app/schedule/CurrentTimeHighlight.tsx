"use client";

import { useEffect, useState } from "react";

interface Entry {
  id: string;
  day: string;
  start_minutes: number;
  end_minutes: number;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function CurrentTimeHighlight({ entries }: { entries: Entry[] }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const day = DAY_NAMES[now.getDay()];
    const minutes = now.getHours() * 60 + now.getMinutes();

    document.querySelectorAll<HTMLElement>("[data-entry-id]").forEach((el) => {
      el.classList.remove("ring-2", "ring-[#F4A28C]", "ring-offset-1", "ring-offset-[#F8F6F0]");
    });

    const current = entries.find(
      (e) => e.day === day && e.start_minutes <= minutes && e.end_minutes > minutes
    );
    if (current) {
      const el = document.querySelector<HTMLElement>(`[data-entry-id="${current.id}"]`);
      if (el) el.classList.add("ring-2", "ring-[#F4A28C]", "ring-offset-1", "ring-offset-[#F8F6F0]");
    }
  }, [now, entries]);

  return null;
}
