import { redirect } from 'next/navigation';

/**
 * 1단계에서 쓰던 경로.
 *
 * 대금 회수 위험은 이제 대시보드에 함께 들어가 있다. 같은 판정을 두 화면으로
 * 두면 어느 쪽이 정본인지 흐려지므로 이 경로는 넘겨만 준다.
 */
export default function DaegeumHoeSuPage() {
  redirect('/aifrm');
}
