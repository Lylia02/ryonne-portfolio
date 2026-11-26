import Garage from '@/components/Garage';
import { pageMetadata } from '@/lib/seo';
import { IMG } from '@/lib/site';

export const metadata = pageMetadata('diagnose', '/diagnose', IMG.hero);

/* The 3D garage: one page, one scene — the car drives in, then explore it,
   repair its glass, see what it is made of, drive it out. The form lives on /contact. */
export default function DiagnosePage() {
  return <Garage />;
}
