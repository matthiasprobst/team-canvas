import { useState } from "react";
import { avatarImageUrl } from "./api";

export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words.at(-1)![0]}` : words[0]?.[0] ?? "U").toLocaleUpperCase();
}

export default function AvatarView({ userId, name, version, hasAvatar, size = 40, className = "" }: {
  userId: string; name: string; version: number; hasAvatar: boolean; size?: number; className?: string;
}) {
  const [failedVersion, setFailedVersion] = useState<number | null>(null);
  const showImage = hasAvatar && failedVersion !== version;
  return <span className={`avatar-view ${className}`} style={{ width: size, height: size, fontSize: Math.max(12, size * .34) }} aria-label={name}>
    {showImage && <img src={avatarImageUrl(userId, version)} alt="" onError={() => setFailedVersion(version)} />}
    {!showImage && initials(name)}
  </span>;
}
