import {
  Anchor,
  Atom,
  Award,
  Bell,
  Bird,
  BookOpen,
  Box,
  Briefcase,
  Brush,
  Building2,
  Bug,
  Calendar,
  Camera,
  ChartColumn,
  ChartLine,
  Clock,
  Cloud,
  Code2,
  Coffee,
  Coins,
  Compass,
  Cpu,
  Crown,
  Database,
  Dna,
  FileText,
  Film,
  Flag,
  FlaskConical,
  Flower2,
  Folder,
  FolderGit2,
  Gamepad2,
  Gem,
  GitBranch,
  Globe,
  GraduationCap,
  Hammer,
  Headphones,
  Heart,
  Home,
  Hourglass,
  Key,
  Landmark,
  Layers,
  Leaf,
  Lightbulb,
  Lock,
  Mail,
  Map,
  MapPin,
  Megaphone,
  MessageCircle,
  Mic,
  Microscope,
  Mountain,
  Music,
  Newspaper,
  Package,
  Palette,
  PenTool,
  PieChart,
  Plane,
  Puzzle,
  Rocket,
  Scissors,
  Send,
  Settings,
  ShieldCheck,
  Smile,
  Sparkles,
  SquareKanban,
  Star,
  Sun,
  Target,
  Terminal,
  ThumbsUp,
  Train,
  TrendingUp,
  TreePine,
  Trophy,
  Truck,
  Users,
  Utensils,
  Wallet,
  Wrench,
  Zap,
  Car,
  Factory,
  Moon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { Project } from "../types";

const projectLucideIcons = {
  anchor: Anchor,
  atom: Atom,
  award: Award,
  bell: Bell,
  bird: Bird,
  "book-open": BookOpen,
  box: Box,
  briefcase: Briefcase,
  brush: Brush,
  "building-2": Building2,
  bug: Bug,
  calendar: Calendar,
  camera: Camera,
  car: Car,
  "chart-column": ChartColumn,
  "chart-line": ChartLine,
  clock: Clock,
  cloud: Cloud,
  "code-2": Code2,
  coffee: Coffee,
  coins: Coins,
  compass: Compass,
  cpu: Cpu,
  crown: Crown,
  database: Database,
  dna: Dna,
  factory: Factory,
  "file-text": FileText,
  film: Film,
  flag: Flag,
  "flask-conical": FlaskConical,
  "flower-2": Flower2,
  folder: Folder,
  "folder-git-2": FolderGit2,
  "gamepad-2": Gamepad2,
  gem: Gem,
  "git-branch": GitBranch,
  globe: Globe,
  "graduation-cap": GraduationCap,
  hammer: Hammer,
  headphones: Headphones,
  heart: Heart,
  home: Home,
  hourglass: Hourglass,
  key: Key,
  landmark: Landmark,
  layers: Layers,
  leaf: Leaf,
  lightbulb: Lightbulb,
  lock: Lock,
  mail: Mail,
  map: Map,
  "map-pin": MapPin,
  megaphone: Megaphone,
  "message-circle": MessageCircle,
  mic: Mic,
  microscope: Microscope,
  moon: Moon,
  mountain: Mountain,
  music: Music,
  newspaper: Newspaper,
  package: Package,
  palette: Palette,
  "pen-tool": PenTool,
  "pie-chart": PieChart,
  plane: Plane,
  puzzle: Puzzle,
  rocket: Rocket,
  scissors: Scissors,
  send: Send,
  settings: Settings,
  "shield-check": ShieldCheck,
  smile: Smile,
  sparkles: Sparkles,
  "square-kanban": SquareKanban,
  star: Star,
  sun: Sun,
  target: Target,
  terminal: Terminal,
  "thumbs-up": ThumbsUp,
  train: Train,
  "tree-pine": TreePine,
  "trending-up": TrendingUp,
  trophy: Trophy,
  truck: Truck,
  utensils: Utensils,
  users: Users,
  wallet: Wallet,
  wrench: Wrench,
  zap: Zap,
} satisfies Record<string, LucideIcon>;

export function teamIconComponent(name: string): LucideIcon {
  return Object.hasOwn(projectLucideIcons, name)
    ? projectLucideIcons[name as keyof typeof projectLucideIcons]
    : FolderGit2;
}

export function TeamIcon({
  className,
  project,
}: {
  className?: string;
  project: Pick<Project, "icon" | "name"> &
    Partial<Pick<Project, "iconName" | "iconColor">>;
}) {
  const NamedIcon = project.iconName
    ? teamIconComponent(project.iconName)
    : null;
  return project.icon ? (
    <img
      alt=""
      className={cn("shrink-0 rounded-sm object-contain", className)}
      src={project.icon}
    />
  ) : NamedIcon ? (
    <NamedIcon
      aria-hidden="true"
      className={cn("shrink-0", className)}
      size={16}
      strokeWidth={1.7}
      style={project.iconColor ? { color: project.iconColor } : undefined}
    />
  ) : (
    <FolderGit2
      aria-hidden="true"
      className={cn("shrink-0", className)}
      size={16}
      strokeWidth={1.7}
    />
  );
}
