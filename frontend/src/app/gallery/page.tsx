import type { Metadata } from "next";
import Image from "next/image";

export const metadata: Metadata = { title: "Gallery" };

const images = [
  {
    src: "/images/underwater.jpg",
    alt: "Underwater drawing with fish",
    category: "drawings",
  },
  {
    src: "/images/house.jpg",
    alt: "House with dog drawing",
    category: "drawings",
  },
];

export default function GalleryPage() {
  return (
    <div className="page-wide">
      <h1>Gallery</h1>
      <p>Drawings, photos, and other visual things.</p>

      <div className="image-grid">
        {images.map((img) => (
          <div key={img.src}>
            <Image
              src={img.src}
              alt={img.alt}
              width={400}
              height={300}
              style={{ width: "100%", height: "auto", borderRadius: "0.5rem" }}
            />
            <span className="tag">{img.category}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
