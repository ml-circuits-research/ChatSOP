import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'training'))
from common import encode_row
class TinyTokenizer:
    def apply_chat_template(self,messages,tokenize=True,add_generation_prompt=False,enable_thinking=False):
        p=[1]+[ord(c) for c in messages[0]['content']]+[2]
        return p if len(messages)==1 else p+[ord(c) for c in messages[1]['content']]+[3]
class TrainingFormatTests(unittest.TestCase):
    def test_response_only_labels(self):
        row=encode_row(TinyTokenizer(),{'id':'x','prompt':'abc','target':'@x value\n  data 1'},100)
        self.assertEqual(row['labels'][:5],[-100]*5)
        self.assertEqual(row['labels'][5:],[ord(c) for c in '@x value\n  data 1']+[3])
        self.assertEqual(len(row['labels']),len(row['input_ids']))
    def test_no_silent_truncation(self):
        with self.assertRaisesRegex(ValueError,'no silent truncation'):
            encode_row(TinyTokenizer(),{'id':'x','prompt':'abc','target':'@x value\n  data 1'},5)
    def test_does_not_supervise_prompt(self):
        r=encode_row(TinyTokenizer(),{'prompt':'întrebare','target':'răspuns'},100)
        self.assertEqual(sum(v!=-100 for v in r['labels']),len('răspuns')+1)
if __name__=='__main__':unittest.main()
