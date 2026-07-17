// Homepage v3 — scroll-driven, gsap.com-style. Built on GSAP ScrollTrigger
// (pin + scrub + snap for the steps showcase, scrubbed marquee, count-up
// stats, batched reveals). Everything degrades to a static page when
// prefers-reduced-motion is set; WebGL/canvas effects degrade gracefully.
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'
import { PublicApi } from '../api.js'
import { Icon } from '../components/Icon.jsx'
import { LogoMark } from '../components/Logo.jsx'
import { inrCompact } from '../format.js'
import { useAuth } from '../ctx/AuthContext.jsx'
import CursorGrid from '../reactbits/CursorGrid.jsx'
import LogoLoop from '../reactbits/LogoLoop.jsx'
import Particles from '../reactbits/Particles.jsx'
import PillNav from '../reactbits/PillNav.jsx'
import RotatingText from '../reactbits/RotatingText.jsx'
import ScrollReveal from '../reactbits/ScrollReveal.jsx'
import SpecularButton from '../reactbits/SpecularButton.jsx'
import VariableProximity from '../reactbits/VariableProximity.jsx'
import './landing.css'

gsap.registerPlugin(ScrollTrigger, useGSAP)

const NAV_ITEMS = [
  { label: 'How it works', href: '#how' },
  { label: 'Security', href: '#security' },
  { label: 'Live', href: '#live' },
  { label: 'FAQ', href: '#faq' },
  { label: 'Sign in', href: '/login' },
]

const ROTATING_CAUSES = ['education', 'medical care', 'your community',
                         'emergencies', 'creative work', 'non-profits']

const STEPS = [
  {
    icon: 'qr', num: '01', title: 'Create',
    body: 'Tell your story, set a goal, upload your UPI QR. Live in five minutes.',
  },
  {
    icon: 'share', num: '02', title: 'Share',
    body: 'One clean link. Supporters scan and pay you directly.',
  },
  {
    icon: 'badge-check', num: '03', title: 'Verify',
    body: 'Confirm each payment yourself. Verified names join your wall.',
  },
]

const MARQUEE_A = ['0% platform fees', 'Direct to your bank', 'Verified by you']
const MARQUEE_B = ['No middlemen', 'Your QR', 'Zero custody', 'Supporter wall']

const SECURITY_ITEMS = [
  { icon: 'lock', title: 'Encrypted in transit', body: 'TLS everywhere, HSTS enforced.' },
  { icon: 'shield', title: 'Hardened accounts', body: 'Argon2id hashing, locked-down sessions.' },
  { icon: 'eye', title: 'Private proof vault', body: 'Screenshots visible only to you.' },
  { icon: 'zap', title: 'Abuse throttling', body: 'Layered rate limits at every door.' },
  { icon: 'badge-check', title: 'Human verification', body: 'No payment trusted automatically.' },
  { icon: 'users', title: 'Data minimalism', body: 'No supporter accounts. Nothing sold.' },
]

const FAQS = [
  { q: 'Does CrowdFund charge any fees?',
    a: 'No. Payments never pass through us, so there is nothing to take. 0%.' },
  { q: 'How does the money reach me?',
    a: 'Supporters scan your own UPI QR and pay you directly, app to app.' },
  { q: 'How does verification work?',
    a: 'A supporter submits their transaction ID or screenshot. You match it against your statement and confirm — only then do they appear on the wall.' },
  { q: 'Do supporters need an account?',
    a: 'No. They pay, submit proof, and get a reference code to track it.' },
  { q: 'Can I run more than one fundraiser?',
    a: 'Yes — unlimited, each with its own page, QR, analytics and exports.' },
  { q: 'What about payment gateways?',
    a: 'QR-first keeps it free and instant. Gateway support is planned as an optional add-on.' },
]

const inrFull = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })

export default function Landing() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const rootRef = useRef(null)
  const heroRef = useRef(null)
  const [live, setLive] = useState(null)

  useEffect(() => {
    PublicApi.index()
      .then(setLive)
      .catch(() => setLive({ campaigns: [], stats: null }))
  }, [])

  const campaigns = live?.campaigns || []
  const stats = live?.stats
  /* The steps section is PINNED by ScrollTrigger (it gets wrapped in a
     spacer div). Sections beside it must always be rendered — React
     inserting/removing siblings of a pinned element crashes reconciliation
     (insertBefore on a moved node). Empty ones are [hidden] instead. */
  const safeStats = stats || { raised: 0, contributions: 0, active_campaigns: 0 }

  /* ---- one-time entrance: masked headline lines rise, chrome fades up.
     Also smooth-scrolls in-page anchors (CSS scroll-behavior would fight
     ScrollTrigger's own scroll writes, so it's done here instead). */
  useGSAP((context, contextSafe) => {
    const root = rootRef.current
    const onAnchorClick = contextSafe((event) => {
      const link = event.target.closest('a[href^="#"]')
      if (!link) return
      const target = document.querySelector(link.getAttribute('href'))
      if (!target) return
      event.preventDefault()
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    root.addEventListener('click', onAnchorClick)

    if (!window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
      return () => root.removeEventListener('click', onAnchorClick)
    }
    gsap.from('.lp-line-inner', {
      yPercent: 112, duration: 1.05, ease: 'power4.out', stagger: 0.13, delay: 0.08,
    })
    gsap.from('.lp-hero-el', {
      y: 18, autoAlpha: 0, duration: 0.8, ease: 'power3.out', stagger: 0.09, delay: 0.55,
    })
    return () => root.removeEventListener('click', onAnchorClick)
  }, { scope: rootRef })

  /* ---- everything scroll-driven. Rebuilt whenever the live data lands
     (sections appear/disappear → trigger positions change). */
  useGSAP(() => {
    const mm = gsap.matchMedia()

    mm.add(
      {
        desktop: '(min-width: 901px)',
        mobile: '(max-width: 900px)',
        motionOK: '(prefers-reduced-motion: no-preference)',
      },
      (context) => {
        const { desktop, motionOK } = context.conditions
        if (!motionOK) return // static page: everything stays visible

        /* hero drifts up + dims as it hands over to the page */
        gsap.to('.lp-hero-inner', {
          yPercent: -9, autoAlpha: 0.25, ease: 'none',
          scrollTrigger: { trigger: '.lp-hero', start: 'top top', end: 'bottom top', scrub: true },
        })

        /* marquee: two giant rows slide opposite ways, tied 1:1 to scroll */
        const marqueeTrigger = {
          trigger: '.lp-marquee', start: 'top bottom', end: 'bottom top', scrub: true,
        }
        gsap.fromTo('.lp-mq-row-a', { xPercent: 0 }, { xPercent: -11, ease: 'none', scrollTrigger: { ...marqueeTrigger } })
        gsap.fromTo('.lp-mq-row-b', { xPercent: -11 }, { xPercent: 0, ease: 'none', scrollTrigger: { ...marqueeTrigger } })

        /* stats: count up once when the band enters */
        gsap.utils.toArray('.lp-stat-num').forEach((el) => {
          const target = Number(el.dataset.target || 0)
          const prefix = el.dataset.prefix || ''
          const counter = { v: 0 }
          el.textContent = prefix + inrFull.format(0)
          gsap.to(counter, {
            v: target, duration: 1.9, ease: 'power2.out',
            scrollTrigger: { trigger: el, start: 'top 88%', once: true },
            onUpdate: () => { el.textContent = prefix + inrFull.format(Math.round(counter.v)) },
          })
        })

        /* the showcase: pin “How it works”, scrub through the three steps */
        const panels = gsap.utils.toArray('.lp-pin-panel')
        const nums = gsap.utils.toArray('.lp-pin-num')
        if (desktop && panels.length > 1) {
          gsap.set(panels.slice(1), { autoAlpha: 0, y: 64 })
          gsap.set(nums.slice(1), { autoAlpha: 0, yPercent: 42 })
          const tl = gsap.timeline({
            defaults: { ease: 'power2.inOut' },
            scrollTrigger: {
              trigger: '.lp-pin', start: 'top top', end: '+=220%',
              pin: true, scrub: 0.8, anticipatePin: 1,
              snap: { snapTo: 1 / (panels.length - 1), duration: { min: 0.15, max: 0.45 }, ease: 'power1.inOut' },
            },
          })
          panels.slice(1).forEach((panel, i) => {
            tl.to(panels[i], { autoAlpha: 0, y: -64, duration: 0.45 }, i)
              .to(nums[i], { autoAlpha: 0, yPercent: -42, duration: 0.45 }, '<')
              .to(panel, { autoAlpha: 1, y: 0, duration: 0.45 }, i + 0.4)
              .to(nums[i + 1], { autoAlpha: 1, yPercent: 0, duration: 0.45 }, '<')
          })
          tl.fromTo('.lp-pin-rail-fill', { scaleY: 1 / panels.length },
                    { scaleY: 1, ease: 'none', duration: panels.length - 1 }, 0)
        }

        /* soft reveals for grid/list content (steps stack on mobile) */
        const revealTargets = [
          ...(desktop ? [] : panels),
          ...gsap.utils.toArray('.lp-sec-item'),
          ...gsap.utils.toArray('.lp-faq-item'),
          ...gsap.utils.toArray('.lp-stat'),
        ]
        if (revealTargets.length) {
          gsap.set(revealTargets, { autoAlpha: 0, y: 26 })
          ScrollTrigger.batch(revealTargets, {
            start: 'top 90%', once: true,
            onEnter: (batch) => gsap.to(batch, {
              autoAlpha: 1, y: 0, duration: 0.75, ease: 'power3.out', stagger: 0.08,
            }),
          })
        }

        /* finale grows in, scrubbed to approach */
        gsap.fromTo('.lp-fin-title', { scale: 0.94, autoAlpha: 0.12 }, {
          scale: 1, autoAlpha: 1, ease: 'none',
          scrollTrigger: { trigger: '.lp-fin', start: 'top 92%', end: 'center 58%', scrub: true },
        })
      },
    )

    return () => mm.revert()
  }, { scope: rootRef, dependencies: [live], revertOnUpdate: true })

  return (
    <div className="lp" ref={rootRef}>
      <PillNav
        logo="/favicon.svg"
        logoAlt="CrowdFund"
        items={NAV_ITEMS}
        activeHref="/"
        baseColor="#0b0e1a"
        pillColor="#f2f4fa"
        hoveredPillTextColor="#f2f4fa"
        pillTextColor="#0b0e1a"
      />

      {/* ------------------------------------------------------------ hero */}
      <header className="lp-hero">
        <Particles
          className="lp-hero-particles"
          particleColors={['#6366f1', '#34d399', '#a5b4fc', '#ffffff']}
          particleCount={240}
          particleSpread={11}
          speed={0.08}
          particleBaseSize={90}
          moveParticlesOnHover
          particleHoverFactor={0.6}
          alphaParticles
          disableRotation={false}
        />
        <div className="lp-container lp-hero-inner" ref={heroRef}>
          <p className="lp-badge lp-hero-el">
            <Icon name="shield" size={13} />
            Direct-to-account payments · Zero platform fees
          </p>
          <h1 className="lp-display lp-hero-title">
            <span className="lp-line">
              <span className="lp-line-inner">
                <VariableProximity
                  label="Raise funds directly."
                  fromFontVariationSettings="'wght' 700"
                  toFontVariationSettings="'wght' 900"
                  containerRef={heroRef}
                  radius={130}
                  falloff="linear"
                />
              </span>
            </span>
            <span className="lp-line lp-line-mint">
              <span className="lp-line-inner">
                <VariableProximity
                  label="Keep every rupee."
                  fromFontVariationSettings="'wght' 700"
                  toFontVariationSettings="'wght' 900"
                  containerRef={heroRef}
                  radius={130}
                  falloff="linear"
                />
              </span>
            </span>
          </h1>
          <div className="lp-rotator lp-hero-el" aria-label="Fund what matters">
            <span className="lp-rotator-static">Built for</span>
            <RotatingText
              texts={ROTATING_CAUSES}
              mainClassName="lp-rotator-word"
              staggerFrom="last"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '-120%' }}
              staggerDuration={0.02}
              splitLevelClassName="lp-rotator-split"
              transition={{ type: 'spring', damping: 30, stiffness: 400 }}
              rotationInterval={2400}
            />
          </div>
          <p className="lp-sub lp-hero-el">
            Your QR. Their support. Money straight to your bank — verified by you.
          </p>
          <div className="lp-cta-row lp-hero-el">
            <SpecularButton
              size="lg"
              radius={5}
              tint="#6366f1"
              tintOpacity={0.16}
              textColor="#ffffff"
              lineColor="#b6bcfc"
              baseColor="#454b78"
              intensity={1.1}
              shineSize={12}
              shineFade={42}
              thickness={1.1}
              proximity={320}
              onClick={() => navigate(user ? '/dashboard' : '/signup')}
            >
              {user ? 'Open your dashboard' : 'Start a fundraiser — free'}
              <Icon name="arrow-right" size={15} />
            </SpecularButton>
            <a className="lp-ghost-link" href="#how">
              See how it works <Icon name="arrow-right" size={13} />
            </a>
          </div>
          <ul className="lp-ticks lp-hero-el">
            <li><Icon name="check" size={13} /> No paperwork</li>
            <li><Icon name="check" size={13} /> Unlimited fundraisers</li>
            <li><Icon name="check" size={13} /> No supporter accounts</li>
          </ul>
        </div>
        <div className="lp-scroll-cue lp-hero-el" aria-hidden="true">
          <span>Scroll</span>
          <span className="lp-scroll-line" />
        </div>
      </header>

      {/* --------------------------------------------------------- marquee */}
      <section className="lp-marquee" aria-hidden="true">
        <div className="lp-mq-row lp-mq-row-a lp-display">
          {[...Array(3)].map((_, i) => (
            <span key={i}>
              {MARQUEE_A.map((text) => (
                <span className="lp-mq-item" key={text}>{text}<em>·</em></span>
              ))}
            </span>
          ))}
        </div>
        <div className="lp-mq-row lp-mq-row-b lp-display">
          {[...Array(3)].map((_, i) => (
            <span key={i}>
              {MARQUEE_B.map((text) => (
                <span className="lp-mq-item lp-mq-ghost" key={text}>{text}<em>·</em></span>
              ))}
            </span>
          ))}
        </div>
      </section>

      {/* ----------------------------------------------------------- stats */}
      <section className="lp-stats" hidden={!stats}>
        <div className="lp-container lp-stats-grid">
          <div className="lp-stat">
            <span className="lp-display lp-stat-num" data-target={Math.round(safeStats.raised)} data-prefix="₹">
              ₹{inrFull.format(Math.round(safeStats.raised))}
            </span>
            <span className="lp-stat-label">verified &amp; raised, all time</span>
          </div>
          <div className="lp-stat">
            <span className="lp-display lp-stat-num" data-target={safeStats.contributions}>
              {inrFull.format(safeStats.contributions)}
            </span>
            <span className="lp-stat-label">verified contributions</span>
          </div>
          <div className="lp-stat">
            <span className="lp-display lp-stat-num" data-target={safeStats.active_campaigns}>
              {inrFull.format(safeStats.active_campaigns)}
            </span>
            <span className="lp-stat-label">fundraisers live now</span>
          </div>
        </div>
      </section>

      {/* ---------------------------------------- how it works (pinned) */}
      <section className="lp-pin" id="how">
        <div className="lp-container lp-pin-frame">
          <div className="lp-pin-left">
            <p className="lp-kicker">How it works</p>
            <div className="lp-pin-count" aria-hidden="true">
              <span className="lp-display lp-pin-nums">
                {STEPS.map((step) => (
                  <span className="lp-pin-num" key={step.num}>{step.num}</span>
                ))}
              </span>
              <span className="lp-pin-total">/ 03</span>
            </div>
            <div className="lp-pin-rail" aria-hidden="true"><span className="lp-pin-rail-fill" /></div>
            <p className="lp-pin-hint">No middlemen at any step.</p>
          </div>
          <div className="lp-pin-panels">
            {STEPS.map((step) => (
              <article className="lp-pin-panel" key={step.num}>
                <span className="lp-step-chip">
                  <Icon name={step.icon} size={18} />
                  <span>Step {step.num}</span>
                </span>
                <h3 className="lp-display lp-pin-title">{step.title}</h3>
                <p className="lp-pin-body">{step.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------- live fundraisers */}
      <section className="lp-live" id="live" hidden={campaigns.length === 0}>
        <div className="lp-container lp-live-head">
          <p className="lp-kicker"><span className="lp-live-dot" aria-hidden="true" /> Live right now</p>
        </div>
        {campaigns.length > 0 && (
          <LogoLoop
            logos={campaigns}
            speed={55}
            direction="left"
            logoHeight={64}
            gap={14}
            hoverSpeed={0}
            fadeOut
            fadeOutColor="#0b0e1a"
            ariaLabel="Ongoing fundraisers"
            renderItem={(c) => (
              <Link to={`/c/${c.slug}`} className="lp-live-chip">
                <span className="lp-live-chip-top">
                  <span className="lp-live-chip-cat">{c.category_label}</span>
                  <span className="lp-live-chip-pct">{Math.min(c.progress, 999)}%</span>
                </span>
                <span className="lp-live-chip-title">{c.title}</span>
                <span className="lp-live-chip-bar" aria-hidden="true">
                  <span style={{ width: `${Math.min(c.progress, 100)}%` }} />
                </span>
                <span className="lp-live-chip-nums">
                  {inrCompact(c.raised)} raised of {inrCompact(c.goal)}
                </span>
              </Link>
            )}
          />
        )}
      </section>

      {/* --------------------------------------------------------- security */}
      <section className="lp-security" id="security">
        <CursorGrid
          cellSize={56}
          color="#6366F1"
          radius={150}
          falloff="smooth"
          holdTime={350}
          fadeDuration={900}
          lineWidth={1}
          maxOpacity={0.85}
          fillOpacity={0.05}
          gridOpacity={0.05}
          cellRadius={2}
          clickPulse
          pulseSpeed={520}
        />
        <div className="lp-container lp-security-inner">
          <div className="lp-head-center">
            <p className="lp-kicker">Security first</p>
            <ScrollReveal baseOpacity={0.08} enableBlur baseRotation={2} blurStrength={6}
                          containerClassName="lp-reveal lp-display-reveal">
              Your money never sits with us. It moves bank to bank —
              and every claim is verified by you.
            </ScrollReveal>
          </div>
          <div className="lp-security-grid">
            {SECURITY_ITEMS.map((item) => (
              <article className="lp-sec-item" key={item.title}>
                <span className="lp-sec-icon"><Icon name={item.icon} size={16} /></span>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------------- FAQ */}
      <section className="lp-section" id="faq">
        <div className="lp-container lp-faq-wrap">
          <div className="lp-head-center">
            <p className="lp-kicker">Questions</p>
            <h2 className="lp-display lp-sect-title">Answers, before you ask</h2>
          </div>
          <Faq items={FAQS} />
        </div>
      </section>

      {/* ---------------------------------------------------------- finale */}
      <section className="lp-fin">
        <div className="lp-container lp-fin-inner">
          <h2 className="lp-display lp-fin-title">Ready when you are.</h2>
          <p className="lp-cta-sub">
            Free forever — live and shareable in the next five minutes.
          </p>
          <div className="lp-cta-actions">
            <SpecularButton
              size="md"
              radius={5}
              tint="#10b981"
              tintOpacity={0.18}
              textColor="#ffffff"
              lineColor="#7df0c6"
              baseColor="#3d6b5c"
              intensity={1.1}
              shineSize={12}
              shineFade={42}
              proximity={280}
              onClick={() => navigate(user ? '/dashboard' : '/signup')}
            >
              {user ? 'Go to dashboard' : 'Create your fundraiser'}
              <Icon name="arrow-right" size={14} />
            </SpecularButton>
            {campaigns[0] && (
              <Link className="lp-ghost-link" to={`/c/${campaigns[0].slug}`}>
                See a live fundraiser <Icon name="external" size={13} />
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ footer */}
      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <div className="lp-footer-brand">
            <span className="lp-footer-logo"><LogoMark size={24} /> <span>Crowd<em>Fund</em></span></span>
            <p>
              Direct, verified community fundraising — payments go straight to the
              organizer, verified by hand.
            </p>
          </div>
          <div className="lp-footer-links">
            <div>
              <span className="lp-footer-h">Product</span>
              <a href="#how">How it works</a>
              <a href="#security">Security</a>
              <a href="#faq">FAQ</a>
            </div>
            <div>
              <span className="lp-footer-h">Get started</span>
              <Link to="/signup">Start a fundraiser</Link>
              <Link to="/login">Sign in</Link>
              {campaigns[0] && <Link to={`/c/${campaigns[0].slug}`}>Live example</Link>}
            </div>
          </div>
        </div>
        <div className="lp-container lp-footer-base">
          <span>© {new Date().getFullYear()} CrowdFund · crowdfund.doxaed.com</span>
          <span className="lp-footer-sec"><Icon name="lock" size={11} /> TLS secured · zero custody · 0% fees</span>
        </div>
      </footer>
    </div>
  )
}

/* Custom accordion — no native <details>, fully keyboard accessible. */
function Faq({ items }) {
  const [open, setOpen] = useState(0)
  return (
    <div className="lp-faq">
      {items.map((item, index) => {
        const isOpen = open === index
        return (
          <div className={`lp-faq-item ${isOpen ? 'is-open' : ''}`} key={item.q}>
            <button
              className="lp-faq-q"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? -1 : index)}
            >
              <span>{item.q}</span>
              <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} />
            </button>
            <div className="lp-faq-a" hidden={!isOpen}>
              <p>{item.a}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
