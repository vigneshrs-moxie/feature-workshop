// Signed out: one button, Sign in with Google. A refused sign-in comes back here as
// #/sign-in?problem=<code> (hosted/site/routes-auth.js), and the page says why in words.
import { BRAND } from '../../app/brand';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { returnTo, type HostedRoute } from './route';
import type { HostedMeta } from './types';

/** Each refusal in words: what happened, and what to do. */
export const PROBLEMS: Record<string, { title: string; say: string }> = {
  domain: { title: 'This site is for Moxie accounts only', say: 'That Google account isn’t a Moxie one, so you aren’t signed in. Choose your Moxie work account and try again.' },
  state: { title: 'That sign-in had run out', say: 'It took more than ten minutes, was used already, or was started in another browser. Sign in again.' },
  expired: { title: 'Google’s answer had run out', say: 'It reached the site too late to be trusted. Sign in again.' },
  'bad-token': { title: 'Google’s answer couldn’t be checked', say: 'So the site didn’t trust it, and you aren’t signed in. Sign in again.' },
  cancelled: { title: 'You stopped the sign-in', say: 'Nothing changed. Sign in when you’re ready.' },
  google: { title: 'Google couldn’t be reached', say: 'Try again in a moment.' },
  account: { title: 'That address belongs to another account', say: 'The site already knows this email from a different Google account. Ask the site’s owner.' },
};

export function SignInPage({ meta, route }: { meta: HostedMeta; route: HostedRoute }) {
  const problem = route.name === 'sign-in' && route.problem ? PROBLEMS[route.problem] ?? { title: 'You aren’t signed in', say: 'Something went wrong with that sign-in. Try again.' } : null;
  const pairing = route.name === 'pair';
  const href = `${meta.signIn || '/api/auth/start'}?return=${encodeURIComponent(returnTo())}`;
  const missing = meta.missing ?? [];
  return (
    <main className="page hosted-signin-page" aria-label="Sign in">
      <div className="page-inner">
        <section className="hosted-signin" aria-labelledby="hosted-signin-title">
          <span className="hosted-signin-mark" aria-hidden="true"><Icon name="radar" size={28} /></span>
          <h2 id="hosted-signin-title" className="page-title">{BRAND.name}</h2>
          {problem && (
            <div className="hosted-problem" role="alert">
              <Icon name="alert" size={16} />
              <div>
                <p className="hosted-problem-title">{problem.title}</p>
                <p className="muted">{problem.say}</p>
              </div>
            </div>
          )}
          <p>{pairing ? 'Sign in to pair your laptop with the site. You come back to the code right after.' : 'Your jobs, from every laptop you paired, in one place you can reach from anywhere. Sign in with your Moxie Google account.'}</p>
          {missing.length > 0 ? (
            <p className="hosted-problem" role="alert"><Icon name="warn" size={16} /><span>The site isn’t set up yet, so nobody can sign in. These settings are missing in Vercel: {missing.join(', ')}.</span></p>
          ) : (
            <Button kind="primary" size="lg" href={href} icon="user" className="hosted-signin-button" title="Opens Google’s sign-in. Only Moxie accounts are let in.">Sign in with Google</Button>
          )}
          {meta.fakeSignIn && <p className="muted hosted-fake-note">This copy of the site uses a pretend Google sign-in, for trying it on a laptop. Any made-up address works; nothing is sent anywhere.</p>}
          <p className="muted hosted-signin-small">Only your name and email come from Google. The site never sees your code: it lives on your laptop.</p>
        </section>
      </div>
    </main>
  );
}
