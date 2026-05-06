"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { AsciiCube } from "./ascii-cube";

// Animated ASCII generators
const asciiAnimations = {
  proofVerification: (frame: number) => {
    const states = ["◌", "◉", "✓"];
    const state = states[frame % states.length];
    return `  dWallet
   ${state}
  Ika Proof
   ✓ VERIFIED`;
  },
  encryption: (frame: number) => {
    const locks = ["◈", "◇", "◆"];
    const l = locks[frame % locks.length];
    return `  🔐 FHE
   ${l}
  Encrypted
   Predicate`;
  },
  circuitBreaker: (frame: number) => {
    const states = ["◉", "●"];
    const state = states[frame % states.length];
    return `  Risk: ${state}
   
  Fail →
  FROZEN`;
  },
  custody: (frame: number) => {
    const arrows = ["→", "→", "→"];
    const arr = arrows[frame % arrows.length];
    return `  Native
   ${arr}
  dWallet
   MPC ✓`;
  },
  sdk: (frame: number) => {
    const dots = [".", "..", "..."];
    const dot = dots[frame % dots.length];
    return `  import PV
   await verify${dot}
   ✓ Verified`;
  },
  monitoring: (frame: number) => {
    const pulse = ["○", "◐", "●"];
    const p = pulse[frame % pulse.length];
    return `  GoldRush
   ${p}
  Events Live
   Real-time`;
  },
};

const features = [
  {
    title: "Proof Verification",
    description: "Ika dWallet custody proofs prove collateral is genuinely locked on its origin chain — cryptographically impossible to forge.",
    animationKey: "proofVerification" as const,
  },
  {
    title: "Encrypted Risk Checks",
    description: "Encrypt FHE evaluates liquidation thresholds on ciphertext. Bots can't see the threshold, can't front-run your circuit breaker.",
    animationKey: "encryption" as const,
  },
  {
    title: "Silent Circuit Breaker",
    description: "Protocol freezes instantly when risk predicate fails, before state is public. Proactive defense, not reactive cleanup.",
    animationKey: "circuitBreaker" as const,
  },
  {
    title: "Native Custody",
    description: "Assets held natively on Bitcoin/Ethereum via Ika MPC. Co-controlled by user + network, never wrapped or bridged.",
    animationKey: "custody" as const,
  },
  {
    title: "@lendguard/sdk",
    description: "One npm package. Three lines of code. Your lending protocol now rejects fake collateral at the program level.",
    animationKey: "sdk" as const,
  },
  {
    title: "GoldRush Monitoring",
    description: "Every LendGuard event indexed real-time. See deposits verified, exploits rejected, freezes triggered — all on-chain.",
    animationKey: "monitoring" as const,
  },
];

function AnimatedAscii({ animationKey }: { animationKey: keyof typeof asciiAnimations }) {
  const [frame, setFrame] = useState(0);
  
  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((f) => f + 1);
    }, 400);
    return () => clearInterval(interval);
  }, []);
  
  const getAscii = useCallback(() => {
    return asciiAnimations[animationKey](frame);
  }, [animationKey, frame]);
  
  return (
    <pre className="font-mono text-xs text-primary leading-tight whitespace-pre">
      {getAscii()}
    </pre>
  );
}

function FeatureCard({
  feature,
  index,
}: {
  feature: (typeof features)[0];
  index: number;
}) {
  const [isVisible, setIsVisible] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true);
      },
      { threshold: 0.2 }
    );

    if (cardRef.current) observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={cardRef}
      className={`group relative rounded-xl p-8 card-shadow transition-all duration-700 hover:border-primary/50 bg-transparent border-0 border-none border-transparent ${
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
      }`}
      style={{ transitionDelay: `${index * 100}ms` }}
    >
      {/* Animated ASCII Icon */}
      <div className="mb-6 h-20 flex items-center">
        <AnimatedAscii animationKey={feature.animationKey} />
      </div>

      {/* Content */}
      <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">
        {feature.description}
      </p>
    </div>
  );
}

export function FeaturesSection() {
  const [isVisible, setIsVisible] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true);
      },
      { threshold: 0.1 }
    );

    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      id="features"
      ref={sectionRef}
      className="relative py-32 overflow-hidden"
    >
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        {/* Header with ASCII cube */}
        <div className="grid lg:grid-cols-2 gap-16 items-center mb-20">
          <div>
            <p className="text-sm font-mono text-primary mb-3">// CORE ARCHITECTURE</p>
            <h2
              className={`text-3xl lg:text-5xl font-semibold tracking-tight mb-6 transition-all duration-700 ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
              }`}
            >
              <span className="text-balance">Three layers to</span>
              <br />
              <span className="text-balance">stop fake collateral.</span>
            </h2>
            <p
              className={`text-lg text-muted-foreground leading-relaxed max-w-lg transition-all duration-700 delay-100 ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
              }`}
            >
              Layer 1: Ika dWallets prove native collateral is locked.
              Layer 2: Encrypt FHE keeps risk thresholds private.
              Layer 3: Anchor program enforces it all at the smart contract level.
            </p>
          </div>
          
          {/* ASCII Cube visualization */}
          <div className="flex justify-center lg:justify-end">
            <AsciiCube className="w-[480px] h-[640px]" />
          </div>
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((feature, index) => (
            <FeatureCard key={feature.title} feature={feature} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
}
