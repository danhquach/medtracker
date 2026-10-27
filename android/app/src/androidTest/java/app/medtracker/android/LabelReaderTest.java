package app.medtracker.android;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.Arrays;
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

        assertTrue(LabelReader.hasNumber(blocks));
        StringBuilder all = new StringBuilder();
        for (String b : blocks) all.append(b).append('\n');
        String text = all.toString();
        assertTrue(text, text.contains("DIN 02242963"));
        assertTrue(text, text.contains("NPN 80058511"));
    }

    // The camera stops on the first frame with a number, so a short or long digit run mustn't count.
    @Test
    public void hasNumberMatchesWhatThePageLooksFor() {
        assertTrue(LabelReader.hasNumber(Arrays.asList("Otrivin", "DIN 0224 2963")));
        assertTrue(LabelReader.hasNumber(Arrays.asList("NPN 80058511")));
        assertFalse(LabelReader.hasNumber(Arrays.asList("LOT 1234567", "EXP 2027-05")));
        assertFalse(LabelReader.hasNumber(Arrays.asList("123456789")));
    }
}
