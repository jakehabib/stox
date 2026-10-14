import {
  BookOpen, Blend, Building2, Calculator, Calendar, CandlestickChart, ClipboardList, Clapperboard, Columns2, FileImage, Film, Gavel,
  GitCompare, HandCoins, Home, Hourglass, Layers, LifeBuoy, Mail, Map, MapPin, Megaphone, MonitorPlay, Newspaper, PiggyBank,
  Presentation, RefreshCw, Rss, Scale, ScanSearch, Send, Share2, Sprout, Sunrise, Target, TrendingUp, Users, Video, Wallet, Zap,
  type LucideIcon,
} from 'lucide-react';

const MAP: Record<string, LucideIcon> = {
  home: Home, candlestick: CandlestickChart, calendar: Calendar, sunrise: Sunrise, newspaper: Newspaper, 'book-open': BookOpen,
  video: Video, users: Users, presentation: Presentation, film: Film, target: Target, columns: Columns2, clipboard: ClipboardList,
  hourglass: Hourglass, refresh: RefreshCw, 'map-pin': MapPin, scale: Scale, 'trending-up': TrendingUp, 'piggy-bank': PiggyBank,
  gavel: Gavel, map: Map, building: Building2, 'home-search': ScanSearch, 'file-image': FileImage, 'hand-coins': HandCoins,
  calculator: Calculator, wallet: Wallet, zap: Zap, 'git-compare': GitCompare, blend: Blend, layers: Layers, sprout: Sprout,
  clapperboard: Clapperboard, mail: Mail, share: Share2, send: Send, 'monitor-play': MonitorPlay, rss: Rss, 'life-buoy': LifeBuoy,
  megaphone: Megaphone,
};

export function ToolIcon({ name, className }: { name: string; className?: string }) {
  const I = MAP[name] ?? Calculator;
  return <I className={className} aria-hidden />;
}
