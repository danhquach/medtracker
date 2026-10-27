package app.medtracker.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;

// MT-122: Tesseract reads a drawn label on the device, with a DIN/NPN sideways or upside down.
@RunWith(AndroidJUnit4.class)
public class LabelReaderTest {

    @Test
    public void readsSidewaysAndUpsideDownNumbers() throws Exception {
        Bitmap label = Bitmap.createBitmap(1600, 1600, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(label);
        canvas.drawColor(Color.WHITE);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(Color.BLACK);
        paint.setTypeface(Typeface.DEFAULT_BOLD);
        paint.setTextSize(64);
        canvas.drawText("ACETAMINOPHEN 500 mg", 100, 150, paint);
        // Sideways, as on a bottle lying down.
        canvas.save();
        canvas.rotate(90, 1300, 300);
        canvas.drawText("DIN 02242963", 1300, 300, paint);
        canvas.restore();
        canvas.save();
        canvas.rotate(180, 800, 650);
        canvas.drawText("NPN 80058511", 500, 650, paint);
        canvas.restore();

        List<String> blocks;
        try (LabelReader reader = new LabelReader(InstrumentationRegistry.getInstrumentation().getTargetContext())) {
            blocks = reader.read(label);
        }

        assertTrue(LabelReader.numbers(blocks).containsAll(Arrays.asList("02242963", "80058511")));
        StringBuilder all = new StringBuilder();
        for (String b : blocks) all.append(b).append('\n');
        String text = all.toString();
        assertTrue(text, text.contains("DIN 02242963"));
        assertTrue(text, text.contains("NPN 80058511"));
    }

    // The camera stops when two frames read the same number, so only 8-digit numbers may count.
    @Test
    public void numbersMatchWhatThePageLooksFor() {
        assertEquals(Collections.singleton("02242963"), LabelReader.numbers(Arrays.asList("Otrivin", "DIN 0224 2963")));
        assertEquals(Collections.singleton("80058511"), LabelReader.numbers(Arrays.asList("NPN 80058511")));
        assertTrue(LabelReader.numbers(Arrays.asList("LOT 1234567", "EXP 2027-05", "123456789")).isEmpty());
        // Misreads of NPN 80058511: no DIN or NPN starts with 6 or 4.
        assertTrue(LabelReader.numbers(Arrays.asList("NPN 60058511", "41989008")).isEmpty());
    }
}
