package app.medtracker.android;

import static org.junit.Assert.assertTrue;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;

// MT-122: Tesseract reads a drawn label on the device, including a DIN/NPN printed upside down.
@RunWith(AndroidJUnit4.class)
public class LabelReaderTest {

    @Test
    public void readsUprightAndUpsideDownNumbers() throws Exception {
        Bitmap label = Bitmap.createBitmap(1600, 900, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(label);
        canvas.drawColor(Color.WHITE);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(Color.BLACK);
        paint.setTypeface(Typeface.DEFAULT_BOLD);
        paint.setTextSize(64);
        canvas.drawText("ACETAMINOPHEN 500 mg", 100, 150, paint);
        canvas.drawText("DIN 02242963", 100, 300, paint);
        canvas.save();
        canvas.rotate(180, 800, 650);
        canvas.drawText("NPN 80058511", 500, 650, paint);
        canvas.restore();

        List<LabelReader.Block> blocks = new LabelReader(InstrumentationRegistry.getInstrumentation().getTargetContext()).read(label);

        StringBuilder all = new StringBuilder();
        for (LabelReader.Block b : blocks) all.append(b.text).append('\n');
        String text = all.toString();
        assertTrue(text, text.contains("DIN 02242963"));
        assertTrue(text, text.contains("NPN 80058511"));
    }
}
