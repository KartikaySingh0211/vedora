"use client";
import * as React from "react";
import Image from "next/image";

interface LogoProps extends React.HTMLAttributes<HTMLDivElement> {
  width?: number;
  height?: number;
}

const Logo = ({ className = "", width = 140, height = 40, ...props }: LogoProps) => {
  return (
    <div className={`flex items-center ${className}`} {...props}>
      <Image
        src="/logo.png"
        alt="Vedora"
        width={width}
        height={height}
        className="h-auto w-auto max-w-40 object-contain"
        priority
      />
    </div>
  );
};

export default Logo;
