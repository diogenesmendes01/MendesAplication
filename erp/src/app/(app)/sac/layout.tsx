import { ChannelNav } from "./components/channel-nav";

export default function SacLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <ChannelNav />
      {children}
    </div>
  );
}
