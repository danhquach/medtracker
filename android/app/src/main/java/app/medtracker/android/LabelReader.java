package app.medtracker.android;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Matrix;
import com.googlecode.tesseract.android.TessBaseAPI;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Reads the text on a label photo with Tesseract, on the phone (MT-122). Its English model ships in
 * the APK's assets, and nothing here uses the network. Not thread-safe: use it from one thread, and
 * close it when done.
 */
class LabelReader implements AutoCloseable {

    private static final String MODEL = "eng.traineddata";

    // 8 digits, or two groups of 4 split by a space or dash: what the page's findCandidates looks for.
    private static final Pattern NUMBER = Pattern.compile("(?<!\\d)(\\d{8}|\\d{4}[ -]\\d{4})(?!\\d)");

    private final TessBaseAPI tess = new TessBaseAPI();

    LabelReader(Context context) throws IOException {
        if (!tess.init(dataDir(context).getPath(), "eng")) {
            tess.recycle();
            throw new IOException("Tesseract didn't start");
        }
        // Adaptive thresholding (Sauvola): reads print on coloured and glossy labels that the default
        // misses (an NPN on a pale green band read in 4 of 5 photos, against 2 of 5).
        tess.setVariable("thresholding_method", "2");
    }

    /**
     * The photo's text blocks (paragraphs, lines split by newlines), read at each quarter turn:
     * Tesseract only reads text the right way up, and a DIN/NPN can be sideways (a bottle lying down)
     * or upside down against the rest of the label. Slow: call it off the main thread.
     */
    List<String> read(Bitmap photo) {
        List<String> blocks = new ArrayList<>();
        for (int degrees = 0; degrees < 360; degrees += 90) {
            tess.setImage(turned(photo, degrees));
            blocks.addAll(blocksOf(tess.getUTF8Text()));
        }
        return blocks;
    }

    /** The 8-digit numbers in the text, digits only. */
    static Set<String> numbers(List<String> blocks) {
        Set<String> found = new LinkedHashSet<>();
        for (String block : blocks) {
            Matcher m = NUMBER.matcher(block);
            while (m.find()) found.add(m.group().replaceAll("\\D", ""));
        }
        return found;
    }

    @Override
    public void close() {
        tess.recycle();
    }

    static Bitmap turned(Bitmap bitmap, int degrees) {
        if (degrees == 0) return bitmap;
        Matrix m = new Matrix();
        m.postRotate(degrees);
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), m, true);
    }

    // Tesseract separates paragraphs with a blank line.
    private static List<String> blocksOf(String text) {
        List<String> blocks = new ArrayList<>();
        if (text == null) return blocks;
        for (String para : text.split("\\n\\s*\\n")) {
            List<String> lines = new ArrayList<>();
            for (String line : para.split("\\n")) if (!line.trim().isEmpty()) lines.add(line.trim());
            if (!lines.isEmpty()) blocks.add(String.join("\n", lines));
        }
        return blocks;
    }

    // Tesseract reads its model from a file, so the bundled one is copied out of the APK once.
    private static File dataDir(Context context) throws IOException {
        File dir = new File(context.getFilesDir(), "tesseract");
        File model = new File(dir, "tessdata/" + MODEL);
        long size = context.getAssets().openFd("tessdata/" + MODEL).getLength();
        if (model.length() != size) {
            model.getParentFile().mkdirs();
            try (InputStream in = context.getAssets().open("tessdata/" + MODEL); OutputStream out = new FileOutputStream(model)) {
                byte[] buf = new byte[1 << 16];
                for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
            }
        }
        return dir;
    }
}
