//! CIE76 distance keeps fixed-palette lowering consistent with perceived color differences.

pub(crate) fn perceptual_distance(a: (u8, u8, u8), b: (u8, u8, u8)) -> f32 {
    fn srgb_to_linear(channel: u8) -> f32 {
        let value = f32::from(channel) / 255.0;
        if value <= 0.04045 {
            value / 12.92
        } else {
            ((value + 0.055) / 1.055).powf(2.4)
        }
    }

    fn lab(rgb: (u8, u8, u8)) -> (f32, f32, f32) {
        let [r, g, b] = [rgb.0, rgb.1, rgb.2].map(srgb_to_linear);
        let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
        let y = r * 0.2126 + g * 0.7152 + b * 0.0722;
        let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
        let curve = |value: f32| {
            if value > 0.008856 {
                value.powf(1.0 / 3.0)
            } else {
                7.787 * value + 16.0 / 116.0
            }
        };
        let (x, y, z) = (curve(x), curve(y), curve(z));
        (116.0 * y - 16.0, 500.0 * (x - y), 200.0 * (y - z))
    }

    let (l1, a1, b1) = lab(a);
    let (l2, a2, b2) = lab(b);
    let (dl, da, db) = (l1 - l2, a1 - a2, b1 - b2);
    (dl * dl + da * da + db * db).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distance_preserves_identity_symmetry_and_reference_white() {
        for color in [(0, 0, 0), (255, 255, 255), (99, 168, 248)] {
            assert_eq!(perceptual_distance(color, color), 0.0);
            assert_eq!(
                perceptual_distance(color, (28, 100, 200)),
                perceptual_distance((28, 100, 200), color),
            );
        }
        assert!((perceptual_distance((0, 0, 0), (255, 255, 255)) - 100.0).abs() < 0.01);
    }
}
