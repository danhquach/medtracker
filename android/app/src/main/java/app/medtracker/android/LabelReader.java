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
import java.util.Arrays;
import java.util.List;

/**
 * Reads the text on a label photo with Tesseract, on the phone (MT-122). Its English model ships in
 * the APK's assets, and nothing here uses the network.
 */
class LabelReader {

    /** A paragraph of text and its lines, the shape the page picks the DIN/NPN out of. */
    static class Block {
        final String text;
        final List<String> lines;

        Block(String text, List<String> lines) {
            this.text = text;
            this.lines = lines;
        }
    }

    private static final String MODEL = "eng.traineddata";

    private final Context context;

    LabelReader(Context context) {
        this.context = context;
    }

    /**
     * The photo's text blocks, read at each quarter turn: Tesseract only reads text the right way up, and
     * a DIN/NPN can be sideways (a bottle lying down) or upside down against the rest of the label. Slow:
     * call it off the main thread.
     */
    List<Block> read(Bitmap photo) throws IOException {
        TessBaseAPI tess = new TessBaseAPI();
        try {
            if (!tess.init(dataDir().getPath(), "eng")) throw new IOException("Tesseract didn't start");
            List<Block> blocks = new ArrayList<>();
            for (int degrees = 0; degrees < 360; degrees += 90) {
                tess.setImage(turned(photo, degrees));
                blocks.addAll(blocksOf(tess.getUTF8Text()));
            }
            return blocks;
        } finally {
            tess.recycle();
        }
    }

    static Bitmap turned(Bitmap bitmap, int degrees) {
        if (degrees == 0) return bitmap;
        Matrix m = new Matrix();
        m.postRotate(degrees);
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), m, true);
    }

    // Tesseract separates paragraphs with a blank line.
    private static List<Block> blocksOf(String text) {
        List<Block> blocks = new ArrayList<>();
        if (text == null) return blocks;
        for (String para : text.split("\\n\\s*\\n")) {
            List<String> lines = new ArrayList<>();
            for (String line : Arrays.asList(para.split("\\n"))) if (!line.trim().isEmpty()) lines.add(line.trim());
            if (!lines.isEmpty()) blocks.add(new Block(String.join("\n", lines), lines));
        }
        return blocks;
    }

    // Tesseract reads its model from a file, so the bundled one is copied out of the APK once.
    private File dataDir() throws IOException {
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
