import Image from "next/image";

export function BrandLogo() {
  return (
    <span className="brand-logo" aria-label="GiroFin">
      <Image
        className="brand-logo__image brand-logo__image--light"
        src="/brand/girofin-dark.png"
        alt="GiroFin"
        width={144}
        height={96}
        priority
      />
      <Image
        className="brand-logo__image brand-logo__image--dark"
        src="/brand/girofin-light.png"
        alt=""
        width={144}
        height={96}
        priority
      />
    </span>
  );
}
