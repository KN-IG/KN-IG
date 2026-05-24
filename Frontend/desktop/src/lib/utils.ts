// shadcn/ui 표준 클래스 병합 유틸. clsx로 조건부 결합 + tailwind-merge로 충돌 클래스 정리.
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
